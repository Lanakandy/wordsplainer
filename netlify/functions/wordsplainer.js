// /netlify/functions/wordsplainer.js

const fetch = require('node-fetch');

// Caching is disabled for now as dynamic prompts (with register + limit) reduce cache hits.
// If re-enabled, the key must include all dynamic parameters.
// function getCacheKey(word, type, register, language, limit) { ... }

async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const primaryModel = "google/gemma-2-9b-it:free"; // Using Gemma 2 as a great free option
    const fallbackModel = "google/gemini-2.0-flash-exp:free";

    let response;
    let chosenModel = primaryModel; // Keep track of which model is used

    // --- TRY 1: Primary Model ---
    try {
        console.log(`Attempting API call with primary model: ${primaryModel}`);
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: primaryModel,
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
            })
        });

        if (!response.ok && response.status === 503) {
             throw new Error(`Primary model returned 503, proceeding to fallback.`);
        }
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Primary model failed with status ${response.status}: ${errorBody}`);
        }
    } catch (error) {
        console.error(`Primary model error: ${error.message}.`);
        response = null; // Ensure response is null so we proceed to fallback
    }

    // --- TRY 2: Fallback Model (if primary failed or was unavailable) ---
    if (!response || !response.ok) {
        console.warn(`Primary model failed. Retrying with fallback: ${fallbackModel}`);
        chosenModel = fallbackModel;
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: fallbackModel,
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Fallback model also failed with status ${response.status}: ${errorBody}`);
        }
    }

    const data = await response.json();
    console.log(`Successfully received response from: ${chosenModel}`);
    return JSON.parse(data.choices[0].message.content);
}

// ⭐ REFINED PROMPT GENERATION
function getLLMPrompt(type, register, word, language = null, limit = 5) {
    const baseInstruction = `You are an expert English language tutor creating educational materials. Your tone is encouraging and clear. The user is a language learner. For the given request, provide a response STRICTLY in the specified JSON object format. Do not include any other text, explanations, or apologies outside of the JSON structure.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All definitions, examples, and explanations must use formal, precise language suitable for a university essay, research paper, or formal presentation. Focus on nuance and sophisticated vocabulary.`
        : `The user has selected the 'Conversational' register. All definitions, examples, and explanations must use natural, everyday language that would be heard in conversations. Use common phrasings and contractions where appropriate.`;
    
    // ⭐ OPTIMIZATION: Pass the 'limit' directly into the prompt
    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt = `Word: "${word}"`;

    switch(type) {
        case 'meaning':
            // Added part_of_speech for better clarity on the frontend
            taskInstruction = `Provide definitions for the main meanings of the word. For each, include its part of speech and an example sentence.
            JSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb", "examples": ["example sentence here"]}]}`;
            break;
        
        case 'context':
            taskInstruction = `List different contexts or domains where this word is commonly used.
            JSON format: {"nodes": [{"text": "Context/Domain Name"}]}`; // Examples are better generated on-demand
            break;

        case 'derivatives':
            // Added part_of_speech here as well, which is very valuable data
            taskInstruction = `Provide word forms (noun, verb, adjective, etc.).
            JSON format: {"nodes": [{"text": "derivative word", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
            
        case 'collocations':
            taskInstruction = `Provide words that often appear together with the target word.
            JSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;

        case 'idioms':
             // Added an 'explanation' field to make idioms understandable
            taskInstruction = `Provide common idioms or phrases that use the word. For each, provide a brief explanation of its meaning.
            JSON format: {"nodes": [{"text": "idiom phrase", "explanation": "meaning of the idiom"}]}`;
            break;

        case 'synonyms':
        case 'opposites':
            const wordType = type === 'synonyms' ? 'synonyms' : 'antonyms (opposites)';
            taskInstruction = `Provide common ${wordType}.
            JSON format: {"nodes": [{"text": "synonym/antonym"}]}`;
            break;

        case 'translation':
             // Simplified to focus on direct translation nodes. Examples are better generated on-demand.
            taskInstruction = `Provide the main translations for the word into the target language.
            JSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
            
        case 'generateExample':
            // The user prompt can now include more context for a better example
            taskInstruction = `Create a single, high-quality, educational example sentence using the word provided in the user prompt. The sentence must clearly demonstrate the word's meaning in the specified register.
            JSON format: {"example": "The generated sentence."}`;
            // NOTE: 'limitInstruction' is not needed for this specific case.
            const systemPrompt = [baseInstruction, registerInstruction, taskInstruction].join('\n\n');
            return { systemPrompt, userPrompt: `Word to use in a sentence: "${word}"` };

        default:
            throw new Error(`Unknown type: ${type}`);
    }

    const systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { word, type, offset = 0, limit = 5, language, register = 'conversational' } = JSON.parse(event.body);

        // ⭐ OPTIMIZATION: The 'offset' parameter is now handled differently.
        // We now pass the 'limit' to the LLM to control the output size.
        // The frontend will handle fetching more by making a new request.
        // This function no longer slices the data, it just returns what the LLM gives.
        
        // ⭐ We've removed on-demand example generation from the main list endpoints.
        // This simplifies the logic and makes the initial load faster.
        // The frontend can now call `generateExample` for any node to get a tailored example.

        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, language, limit);
        
        const apiResponse = await callOpenRouter(systemPrompt, userPrompt);
        
        let responseData;
        if (type === 'generateExample') {
            responseData = apiResponse; // e.g., { example: "..." }
        } else {
            const allNodes = apiResponse.nodes || [];
            responseData = {
                nodes: allNodes,
                // The concept of 'hasMore' can now be simplified on the frontend.
                // If you receive `limit` items back, you can assume there might be more.
                hasMore: allNodes.length === limit,
                total: null // We no longer know the absolute total, which is fine.
            };
        }

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};