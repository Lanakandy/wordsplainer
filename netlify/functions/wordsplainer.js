// /netlify/functions/wordsplainer.js
const fetch = require('node-fetch');

async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const primaryModel = "google/gemma-2-9b-it:free";

    console.log(`Attempting API call with primary model: ${primaryModel}`);
    
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: primaryModel,
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error(`Primary model failed with status ${response.status}: ${errorBody}`);
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    console.log(`Successfully received response from: ${primaryModel}`);
    console.log("Full API response:", JSON.stringify(data, null, 2));

    if (!data.choices || data.choices.length === 0) {
        console.error("OpenRouter API returned no choices. Full response:", JSON.stringify(data, null, 2));
        throw new Error("The AI model returned no response choices.");
    }

    const choice = data.choices[0];
    if (!choice.message) {
        console.error("OpenRouter API choice has no message. Full response:", JSON.stringify(data, null, 2));
        throw new Error("The AI model returned an invalid response structure.");
    }

    const messageContent = choice.message.content;
    if (!messageContent || typeof messageContent !== 'string') {
        console.error("OpenRouter API message has no content. Full response:", JSON.stringify(data, null, 2));
        throw new Error("The AI model returned empty content.");
    }

    try {
        const parsedContent = JSON.parse(messageContent);
        console.log("Successfully parsed JSON content:", parsedContent);
        return parsedContent;
    } catch (parseError) {
        console.error("Failed to parse JSON content:", messageContent);
        console.error("Parse error:", parseError.message);
        
        // Try to extract any meaningful content or provide a fallback
        throw new Error(`The AI model returned invalid JSON: ${parseError.message}`);
    }
}

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
            taskInstruction = `Provide word forms (noun, verb, adjective, etc.).
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
        
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, language, limit);
        
        const apiResponse = await callOpenRouter(systemPrompt, userPrompt);
        
        let responseData;
        if (type === 'generateExample') {
            responseData = apiResponse;
        } else {
            const allNodes = apiResponse.nodes || [];
            responseData = {
                nodes: allNodes,
                hasMore: allNodes.length === limit,
                total: null
            };
        }

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};