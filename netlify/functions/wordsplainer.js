// /netlify/functions/wordsplainer.js - CORRECTED WITH FALLBACK

const fetch = require('node-fetch');

// This is the prompt generation function, it remains the same.
function getLLMPrompt(type, register, word, language = null, limit = 5) {
    const baseInstruction = `You are an expert English language tutor creating educational materials. Your tone is encouraging and clear. The user is a language learner. For the given request, provide a response STRICTLY in the specified JSON object format. Do not include any other text, explanations, or apologies outside of the JSON structure.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All definitions, examples, and explanations must use formal, precise language suitable for a university essay, research paper, or formal presentation. Focus on nuance and sophisticated vocabulary.`
        : `The user has selected the 'Conversational' register. All definitions, examples, and explanations must use natural, everyday language that would be heard in conversations. Use common phrasings and contractions where appropriate.`;
    
    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt = `Word: "${word}"`;

    switch(type) {
        case 'meaning':
            taskInstruction = `Provide definitions for the main meanings of the word. For each, include its part of speech and an example sentence.
            JSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb", "examples": ["example sentence here"]}]}`;
            break;
        case 'context':
            taskInstruction = `List different contexts or domains where this word is commonly used.
            JSON format: {"nodes": [{"text": "Context/Domain Name"}]}`;
            break;
        case 'derivatives':
            taskInstruction = `Provide word forms (noun, verb, adjective, etc.). All word forms should have the same root.
            JSON format: {"nodes": [{"text": "derivative word", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'collocations':
            taskInstruction = `Provide words that often appear together with the target word.
            JSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;
        case 'idioms':
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
            taskInstruction = `Provide the main translations for the word into the target language.
            JSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
        case 'generateExample':
            taskInstruction = `Create a single, high-quality, educational example sentence using the word provided in the user prompt. The sentence must clearly demonstrate the word's meaning in the specified register.
            JSON format: {"example": "The generated sentence."}`;
            const systemPromptForExample = [baseInstruction, registerInstruction, taskInstruction].join('\n\n');
            return { systemPrompt: systemPromptForExample, userPrompt: `Word to use in a sentence: "${word}"` };
        default:
            throw new Error(`Unknown type: ${type}`);
    }

    const systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

// ⭐ NEW: This function now tries multiple models if the first one fails.
async function callOpenRouterWithFallback(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    // Define a list of models to try in order of preference.
    const modelsToTry = [
        "mistralai/mistral-7b-instruct:free", // A good, reliable free fallback
        "openai/gpt-3.5-turbo" // A cheap, very reliable paid option if free ones fail
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
                continue; // Try the next model
            }

            const data = await response.json();

            // Check for a valid, non-empty response
            if (data.choices && data.choices.length > 0 && data.choices[0].message?.content) {
                console.log(`Successfully received response from: ${model}`);
                const messageContent = data.choices[0].message.content;
                
                try {
                    const parsedContent = JSON.parse(messageContent);
                    return parsedContent; // Success! Return the result.
                } catch (parseError) {
                    console.warn(`Model '${model}' returned unparseable JSON. Trying next model.`);
                    continue; // Invalid JSON, try next model
                }
            } else {
                console.warn(`Model '${model}' returned no choices. Trying next model.`);
            }

        } catch (error) {
            console.error(`An unexpected network error occurred with model '${model}':`, error);
        }
    }

    // If all models in the list have failed.
    console.error("All AI models failed to provide a valid response.");
    throw new Error("The AI model could not provide a response. Please try a different word or try again later.");
}

// The main handler now uses the new fallback function.
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { word, type, offset = 0, limit = 5, language, register = 'conversational' } = JSON.parse(event.body);
        
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, language, limit);
        
        // Use the new function with built-in retries and fallbacks
        const apiResponse = await callOpenRouterWithFallback(systemPrompt, userPrompt);
        
        let responseData;
        if (type === 'generateExample') {
            responseData = apiResponse;
        } else {
            // Default to an empty array if the API somehow returns null/undefined
            const allNodes = apiResponse.nodes || [];
            responseData = {
                nodes: allNodes,
                hasMore: allNodes.length === limit && allNodes.length > 0, // hasMore is false if no nodes were returned
                total: null
            };
        }

        // Always return 200 OK, even with empty data, to prevent client-side error state
        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        // This catch block now only triggers for critical errors (e.g., if all models fail)
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};