// /netlify/functions/wordsplainer.js

// Using node-fetch as specified in your package.json
const fetch = require('node-fetch');

// This function calls the OpenRouter API. It's the core of our new logic.
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

    // Safety check: ensure the API key is configured in Netlify.
    if (!OPENROUTER_API_KEY) {
        throw new Error('API key is not configured.');
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            // Let's use a modern, capable model.
            // You can experiment with others like 'mistralai/mistral-7b-instruct'
            "model": "mistralai/mistral-small-3.2-24b-instruct:free",
            "response_format": { "type": "json_object" }, // CRITICAL: This forces the AI to output valid JSON.
            "messages": [
                { "role": "system", "content": systemPrompt },
                { "role": "user", "content": userPrompt }
            ]
        })
    });

    if (!response.ok) {
        // Provide more detailed error information if the API call fails
        const errorBody = await response.text();
        console.error("OpenRouter API Error:", errorBody);
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    // We expect the JSON content to be a string, so we parse it again.
    return JSON.parse(data.choices[0].message.content);
}

// =================================================================
// PROMPT ENGINEERING SECTION
// This is where we tell the AI how to behave for each category.
// =================================================================
function getSystemPrompts(type, language = null) {
    const baseFormat = 'You are a linguistic data expert. You will be given a word and must respond with a JSON object containing a "nodes" array. Each object in the "nodes" array should have a "text" property. Do not add any conversational text.';

    const prompts = {
        meaning: `You are an English dictionary assistant. You will be given a word. Respond with a JSON object. This object must have a "nodes" array. Inside this array, provide ONE object containing the primary definition in a "text" property and a "examples" array with two distinct, lowercase example sentences.
        Example response for "happy": {"nodes": [{"text": "feeling or showing pleasure or contentment.", "examples": ["she was happy to be home", "a happy coincidence"]}]}`,

        synonyms: `${baseFormat} The "nodes" should contain objects with common synonyms for the given word.`,
        opposites: `${baseFormat} The "nodes" should contain objects with common antonyms (opposites) for the given word.`,
        derivatives: `${baseFormat} The "nodes" should contain objects with related words or derivatives (e.g., for "plan", return "planning", "planner").`,
        collocations: `${baseFormat} The "nodes" should contain objects with common collocations (words that frequently appear together).`,
        idioms: `${baseFormat} The "nodes" should contain objects with common idioms that include the given word.`,
        context: `${baseFormat} The "nodes" should contain single-word contexts or domains where the given word is commonly used (e.g., for "plan", return "business", "strategy").`,
        
        translation: `You are a translator. You will be given a word and a target language code ('${language}'). Respond with a JSON object containing a "nodes" array. Inside, provide ONE object with the translation in a "text" property. Additionally, provide an "exampleTranslations" object. This object's keys should be the English example sentences related to the original word, and the values should be their translations into the target language.
        Example response for word "plan" and language "es":
        {"nodes":[{"text":"el plan"}], "exampleTranslations":{"the plan was to meet at the cafe":"el plan era encontrarse en el café","do you have a backup plan?":"¿tienes un plan de respaldo?"}}`
    };

    return prompts[type];
}


// This is the main Netlify function handler.
exports.handler = async function(event) {
    // Only allow POST requests, as specified in your frontend.
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { word, type, offset = 0, limit = 5, language } = JSON.parse(event.body);
        
        // 1. Get the appropriate system prompt for the requested data type.
        const systemPrompt = getSystemPrompts(type, language);
        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid data type requested.' }) };
        }

        // 2. Formulate the user prompt. For translations, we need to provide more context.
        let userPrompt;
        if (type === 'translation') {
            userPrompt = `Translate the word "${word}" to the language with code "${language}". Use these English sentences for context: "the plan was to meet at the cafe" and "do you have a backup plan?".`;
        } else {
            userPrompt = `Word: "${word}"`;
        }

        // 3. Call the OpenRouter API.
        const aiResponse = await callOpenRouter(systemPrompt, userPrompt);
        
        // 4. Paginate the results (if applicable).
        // The AI gives us all results at once; we paginate them on our server before sending to the frontend.
        const allNodes = aiResponse.nodes || [];
        const total = allNodes.length;
        const paginatedNodes = allNodes.slice(offset, offset + limit);
        const hasMore = (offset + limit) < total;

        // 5. Construct the final response object in the format your frontend expects.
        const response = {
            nodes: paginatedNodes,
            hasMore: hasMore,
            total: total,
            // For translations, pass the extra data through. For others, this will be undefined, which is fine.
            exampleTranslations: aiResponse.exampleTranslations 
        };

        return {
            statusCode: 200,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error("Error in wordsplainer function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};