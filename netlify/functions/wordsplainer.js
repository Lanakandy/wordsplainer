// wordsplainer.js

const fetch = require('node-fetch');

function getLLMPrompt(type, register, proficiency, ageGroup, word, options = {}) {
    const { 
        language = null, 
        limit = 5, 
        centralWord = null, 
        context = null, 
        sourceNodeType = null,
        definition = null,
        translation = null,
        previousWords = []
    } = options;

    const proficiencyString = proficiency === 'low'
        ? "Low (CEFR A2-B1). CRITICAL: Use simple, common vocabulary and basic grammatical structures. Sentences must be short and direct. Avoid all idioms and complex metaphors."
        : "High (Native/C1+). Employ a wide and sophisticated vocabulary, complex grammatical structures, and nuanced idiomatic expressions appropriate for a native speaker.";

    let systemPromptPreamble;
    const userProfileBlock = `
Your response MUST be adapted for the following user profile:
- **Target Audience:** ${ageGroup === 'teens' 
    ? "Teens/Schoolkids. Content must be fun, engaging, and relatable (social media, gaming, school life). Use a playful, energetic tone." 
    : "Adults. Content can be mature, nuanced, and relevant to modern context."}
- **Proficiency Level:** ${proficiencyString}
- **Communication Style (Register):** Strictly 'Conversational'.`;

    switch (register) {
        case 'academic':
            systemPromptPreamble = `You are a scholarly linguist explaining vocabulary in academic context. Your tone must be objective, precise, and formal.
${userProfileBlock.replace("Strictly 'Conversational'", "Strictly 'Academic'")}
- Avoid all colloquialisms, contractions, and first/second-person pronouns.
- Use complex sentence structures and technical vocabulary where appropriate.`;
            break;

        case 'business':
            systemPromptPreamble = `You are a professional corporate communications consultant. Your tone must be clear, concise, and action-oriented.
${userProfileBlock.replace("Strictly 'Conversational'", "Strictly 'Business'")}
- Focus on professional work environment.
- Avoid slang and overly academic language.`;
            break;

        case 'conversational':
        default:
            systemPromptPreamble = `You are a witty English native speaker explaining English vocabulary in a non-trivial and fun way. Use humor, similies and metaphors, where appropriate.
${userProfileBlock}
- **CRITICAL:** Your tone must be completely informal, like you're talking to a friend over coffee. Use conversational grammar and colloquialisms.
- Your examples MUST come from everyday life (hobbies, social situations, pop culture, etc.).
- For 'meaning' and 'generateExample' tasks, you MUST provide at least one example as a short, realistic dialogue.`;
            break;
    }
   
    const finalFormatInstruction = `CRITICAL: Your entire response must be ONLY the valid JSON object specified in the task, with no extra text, commentary, or markdown formatting.`;
    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt = `Word: "${word}"`;
    let systemPrompt;

    switch(type) {
        // ... (cases for meaning, context, etc. are unchanged)
        case 'meaning':
            taskInstruction = `Task: Provide definitions for the main meanings of the target word. Include a part of speech for each definition.\nJSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'context':
            taskInstruction = `Task: List different contexts or domains where this word is commonly used.\nJSON format: {"nodes": [{"text": "Context/Domain Name"}]}`;
            break;
        case 'derivatives':
            taskInstruction = `Task: Provide word forms (noun, verb, adjective, etc.) with the same root.\nJSON format: {"nodes": [{"text": "derivative word", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'collocations':
            taskInstruction = `Task: Provide common collocations. Each phrase MUST contain the target word.\nJSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;
        case 'idioms':
            taskInstruction = `Task: Provide idioms or set phrases. Every single idiom MUST contain the exact target word.\nJSON format: {"nodes": [{"text": "idiom phrase"}]}`;
            break;
        case 'synonyms':
            taskInstruction = `Task: Provide common single-word synonyms.\nJSON format: {"nodes": [{"text": "the synonym here"}]}`;
            break;
        case 'opposites':
            taskInstruction = `Task: Provide common single-word antonyms (opposites).\nJSON format: {"nodes": [{"text": "the antonym here"}]}`;
            break;        
        case 'translation':
            taskInstruction = `Task: Provide the main translations for the word into the target language.\nJSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
        
        case 'generateWordLadderChallenge':
            let avoidInstruction = '';
            if (previousWords && previousWords.length > 0) {
                avoidInstruction = `\nCRITICAL AVOIDANCE: The start and end words MUST NOT be any of the following: ${previousWords.join(', ')}.`;
            }
            taskInstruction = `You are a cunning game designer creating clever word puzzles. Your goal is to create a 'Word Weaver' challenge that requires lateral thinking and makes the player say "Aha!" when they find the connection.

Follow these rules strictly:
1.  **Word Choice:** The start and end words must be common, concrete English nouns.
2.  **The Connection:** The link between the words must be indirect and surprising, often by bridging two different conceptual domains.
    - **Good Examples:** "cloud" -> "server" (bridges meteorology and technology), "key" -> "music" (bridges a physical tool and an art form), "web" -> "spider" (bridges technology and nature).
    - **Bad Examples:** "dog" -> "cat" (too obvious, same domain), "sea" -> "ocean" (direct synonym), "hot" -> "cold" (direct opposite).
3.  **Solvability:** The logical path between the words should be solvable in approximately 4-7 conceptual steps for a creative thinker.${avoidInstruction}

CRITICAL: Do not provide the path, only the two words.

JSON format: {"startWord": "word here", "endWord": "word here"}`;
            systemPrompt = `You are a helpful assistant generating game content in JSON format.\n\n${taskInstruction}\n\n${finalFormatInstruction}`;
            userPrompt = "Generate a new, clever, and non-obvious challenge.";
            return { systemPrompt, userPrompt };
        
        case 'generateExample':
            if (sourceNodeType === 'idioms') {
                taskInstruction = `Task: Create a single, engaging example sentence for the given idiom and provide a brief explanation of its meaning.\nJSON format: {"example": "The generated sentence.", "explanation": "The explanation of the idiom."}`;
                userPrompt = `Idiom to use and explain: "${word}"`;
            } else if (sourceNodeType === 'meaning' && centralWord && definition) {
                taskInstruction = `Task: Create a single, high-quality example sentence for the word "${centralWord}" that clearly illustrates this specific definition: "${definition}".\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Definition to illustrate: "${definition}"`;
            } else if (centralWord && context) {
                taskInstruction = `Task: Create a single, high-quality example sentence using "${centralWord}" in a way that is specific to the field of "${context}".\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Context: "${context}"`;
            } else if (sourceNodeType === 'translation' && centralWord && translation && language) {
                taskInstruction = `Task: Create a high-quality English example sentence using "${centralWord}". Then, provide its direct translation into ${language}.\nJSON format: {"english_example": "The English sentence.", "translated_example": "The sentence in the target language."}`;
                userPrompt = `English Word: "${centralWord}", Target Language: "${language}", Translation: "${translation}"`;
            } else {
                taskInstruction = `Task: Create a single, high-quality, engaging example sentence using the provided word.\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word to use in a sentence: "${word}"`;
            }
            // Use the new preamble to construct the prompt
            systemPrompt = [systemPromptPreamble, taskInstruction, finalFormatInstruction].join('\n\n');
            return { systemPrompt, userPrompt };

        default:
            throw new Error(`Unknown type: ${type}`);
    }
    
    // Use the new preamble to construct the prompt
    systemPrompt = [systemPromptPreamble, limitInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

// ... the rest of the file (callOpenRouterWithFallback, handler) is unchanged ...
async function callOpenRouterWithFallback(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const modelsToTry = [
        "meta-llama/llama-3.2-3b-instruct",
        "tngtech/deepseek-r1t-chimera:free",        
        "openai/gpt-oss-20b:free",
        "google/gemini-2.0-flash-exp:free",
        "mistralai/mistral-small-3.2-24b-instruct:free",
        "google/gemma-3-12b-it:free",
        "meta-llama/llama-3.1-8b-instruct"
                      
      ];

    for (const model of modelsToTry) {
        console.log(`Attempting API call with model: ${model}`);
        try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
                headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: model,
                    response_format: { type: "json_object" },
                    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
                })
            });

        if (!response.ok) {
                const errorBody = await response.text();
                console.warn(`Model '${model}' failed with status ${response.status}: ${errorBody}`);
                continue;
            }

            const data = await response.json();

            if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                console.log(`Successfully received response from: ${model}`);
                const messageContent = data.choices[0].message.content;
                
                try {
                    const parsedContent = JSON.parse(messageContent);
                    return parsedContent;
                } catch (parseError) {
                    console.warn(`Model '${model}' returned unparseable JSON. Trying next model.`);
                    continue;
                }
            } else {
                console.warn(`Model '${model}' returned no choices. Trying next model.`);
            }

        } catch (error) {
            console.error(`An unexpected network error occurred with model '${model}':`, error);
        }
    }

    console.error("All AI models failed to provide a valid response.");
    throw new Error("The AI model could not provide a response. Please try a different word or try again later.");
}

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const body = JSON.parse(event.body);
        const { word, type, register = 'conversational', proficiency = 'high', ageGroup = 'adults' } = body;
        
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, proficiency, ageGroup, word, body);
        
        const apiResponse = await callOpenRouterWithFallback(systemPrompt, userPrompt);
        
        let responseData;
        if (type === 'generateWordLadderChallenge') {
            return { statusCode: 200, body: JSON.stringify(apiResponse) };
        }
        
        if (type === 'generateExample') {
            responseData = apiResponse;
        } else {
            let allNodes = apiResponse.nodes || [];
            const typesToNormalize = ['synonyms', 'opposites', 'derivatives'];

            if (typesToNormalize.includes(type)) {
                allNodes = allNodes
                    .filter(node => node && typeof node.text === 'string')
                    .map(node => ({
                        ...node,
                        text: node.text.toLowerCase() 
                    }))
                    .filter(node => node.text !== word.toLowerCase());
            }
            
            const requestLimit = body.limit || 5; 
            responseData = {
                nodes: allNodes,
                hasMore: allNodes.length === requestLimit && allNodes.length > 0,
                total: null
            };
        }

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};