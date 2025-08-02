// Rate limiting (simple in-memory store - consider Redis for production)
const rateLimits = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 20; // per minute per IP

function checkRateLimit(ip) {
  const now = Date.now();
  const userRequests = rateLimits.get(ip) || [];
  
  // Remove old requests outside the window
  const recentRequests = userRequests.filter(time => now - time < RATE_LIMIT_WINDOW);
  
  if (recentRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  
  recentRequests.push(now);
  rateLimits.set(ip, recentRequests);
  return true;
}

function createPrompt(word, type, language = null) {
  const basePrompts = {
    meaning: `Provide the main definition of the word "${word}". Return exactly 1 definition with 2 example sentences. Format as JSON with this exact structure:
    {
      "nodes": [{"text": "Clear, concise definition here", "examples": ["Example sentence 1", "Example sentence 2"]}],
      "hasMore": false,
      "total": 1
    }`,
    
    context: `Provide 3 different contexts or situations where the word "${word}" is commonly used. Format as JSON:
    {
      "nodes": [{"text": "Context 1"}, {"text": "Context 2"}, {"text": "Context 3"}],
      "hasMore": false,
      "total": 3
    }`,
    
    derivatives: `List 3 word forms derived from "${word}" (like different verb forms, adjectives, adverbs, etc.). Format as JSON:
    {
      "nodes": [{"text": "derivative1"}, {"text": "derivative2"}, {"text": "derivative3"}],
      "hasMore": false,
      "total": 3
    }`,
    
    idioms: `List 3 common idioms, phrases, or expressions that include the word "${word}". Format as JSON:
    {
      "nodes": [{"text": "idiom or phrase 1"}, {"text": "idiom or phrase 2"}, {"text": "idiom or phrase 3"}],
      "hasMore": false,
      "total": 3
    }`,
    
    collocations: `List 3 common word combinations or phrases that naturally go with "${word}". Format as JSON:
    {
      "nodes": [{"text": "collocation1"}, {"text": "collocation2"}, {"text": "collocation3"}],
      "hasMore": false,
      "total": 3
    }`,
    
    synonyms: `List 3 synonyms for the word "${word}". Format as JSON:
    {
      "nodes": [{"text": "synonym1"}, {"text": "synonym2"}, {"text": "synonym3"}],
      "hasMore": false,
      "total": 3
    }`,
    
    opposites: `List 3 antonyms or opposites for the word "${word}". Format as JSON:
    {
      "nodes": [{"text": "opposite1"}, {"text": "opposite2"}, {"text": "opposite3"}],
      "hasMore": false,
      "total": 3
    }`
  };

  if (type === 'translation' && language) {
    const languageNames = {
      es: 'Spanish', 
      fr: 'French', 
      de: 'German', 
      ja: 'Japanese', 
      it: 'Italian', 
      ru: 'Russian',
      pt: 'Portuguese',
      zh: 'Chinese',
      ko: 'Korean',
      ar: 'Arabic'
    };
    
    return `Translate the word "${word}" to ${languageNames[language]} and provide 2 example sentences with their translations. Format as JSON:
    {
      "nodes": [{"text": "See translation...", "translationData": {"${language}": "translated_word_here"}}],
      "exampleTranslations": {
        "First example sentence in English.": {"${language}": "Translation of first sentence"},
        "Second example sentence in English.": {"${language}": "Translation of second sentence"}
      },
      "hasMore": false,
      "total": 1
    }`;
  }

  return basePrompts[type] + '\n\nRespond ONLY with valid JSON, no additional text or explanations.';
}

async function callOpenRouter(messages, model = 'google/gemma-3-12b-it:free') {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.URL || 'http://localhost:8888', // Your site URL
      'X-Title': 'Wordsplainer App' // Your app name
    },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: 0.7,
      max_tokens: 1000,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenRouter API Error:', response.status, errorText);
    throw new Error(`OpenRouter API Error: ${response.status} - ${errorText}`);
  }

  return response.json();
}

exports.handler = async (event, context) => {
  // CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Rate limiting
    const clientIP = event.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                     event.headers['x-real-ip'] || 
                     event.headers['client-ip'] || 
                     'unknown';
    
    if (!checkRateLimit(clientIP)) {
      return {
        statusCode: 429,
        headers,
        body: JSON.stringify({ error: 'Rate limit exceeded. Please wait a minute.' })
      };
    }

    // Parse request body
    let requestBody;
    try {
      requestBody = JSON.parse(event.body);
    } catch (parseError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid JSON in request body' })
      };
    }

    const { 
      word, 
      type, 
      offset = 0, 
      limit = 3, 
      model = 'google/gemma-3-12b-it:free', 
      language 
    } = requestBody;

    // Validate inputs
    if (!word || !type) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing required parameters: word and type' })
      };
    }

    // Validate word input (basic sanitization)
    if (typeof word !== 'string' || word.length > 100 || !/^[a-zA-Z\s\-']+$/.test(word.trim())) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid word parameter' })
      };
    }

    const validTypes = ['meaning', 'context', 'derivatives', 'idioms', 'collocations', 'synonyms', 'opposites', 'translation'];
    if (!validTypes.includes(type)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid type parameter' })
      };
    }

    // Validate model parameter
    const validModels = [
      'google/gemma-3-12b-it:free',
      'openai/gpt-4o-mini'
    ];
    
    if (!validModels.includes(model)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid model parameter' })
      };
    }

    // Validate language for translation requests
    if (type === 'translation') {
      const validLanguages = ['es', 'fr', 'de', 'ja', 'it', 'ru', 'pt', 'zh', 'ko', 'ar'];
      if (!language || !validLanguages.includes(language)) {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid or missing language parameter for translation' })
        };
      }
    }

    // Create the prompt
    const prompt = createPrompt(word.trim(), type, language);

    // Prepare messages for the AI
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful English language learning assistant. Always respond with valid JSON only. Do not include any explanatory text outside the JSON structure. Be accurate and educational.'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    // Call OpenRouter API
    const completion = await callOpenRouter(messages, model);

    if (!completion.choices || completion.choices.length === 0) {
      throw new Error('No response from AI model');
    }

    const responseText = completion.choices[0].message.content.trim();
    
    // Parse the JSON response
    let parsedResponse;
    try {
      // Clean the response in case there's any extra text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      const cleanJsonText = jsonMatch ? jsonMatch[0] : responseText;
      parsedResponse = JSON.parse(cleanJsonText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError, 'Response:', responseText);
      
      // Fallback: create a basic response structure
      parsedResponse = {
        nodes: [{ text: `Unable to process "${word}" for ${type}. Please try again.` }],
        hasMore: false,
        total: 1
      };
    }

    // Validate the parsed response structure
    if (!parsedResponse.nodes || !Array.isArray(parsedResponse.nodes)) {
      parsedResponse.nodes = [{ text: `No ${type} data available for "${word}"` }];
    }

    // Ensure required fields exist
    if (typeof parsedResponse.hasMore === 'undefined') {
      parsedResponse.hasMore = false;
    }
    if (typeof parsedResponse.total === 'undefined') {
      parsedResponse.total = parsedResponse.nodes.length;
    }

    // Add required fields for compatibility with existing frontend
    const result = {
      centralWord: word.trim(),
      primaryDefinition: `AI-generated content for "${word}"`,
      ...parsedResponse
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(result)
    };

  } catch (error) {
    console.error('Function Error:', error);
    
    let errorMessage = 'Internal server error';
    let statusCode = 500;

    if (error.message.includes('rate limit') || error.message.includes('429')) {
      errorMessage = 'AI service rate limit exceeded. Please try again later.';
      statusCode = 429;
    } else if (error.message.includes('API key') || error.message.includes('401')) {
      errorMessage = 'API configuration error';
      statusCode = 500;
    } else if (error.message.includes('Invalid JSON') || error.message.includes('parse')) {
      errorMessage = 'Failed to process AI response. Please try again.';
      statusCode = 502;
    } else if (error.message.includes('fetch') || error.message.includes('network')) {
      errorMessage = 'Network error connecting to AI service. Please try again.';
      statusCode = 503;
    }

    return {
      statusCode,
      headers,
      body: JSON.stringify({ 
        error: errorMessage,
        timestamp: new Date().toISOString()
      })
    };
  }
};