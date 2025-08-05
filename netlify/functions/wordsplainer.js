// /netlify/functions/wordsplainer.js - OPENAI GPT-4.1-NANO VERSION

const fetch = require('node-fetch');

// This is the prompt generation function, unchanged
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

// ⭐ New function using OpenAI GPT-4.1-Nano
async function callOpenAIModel(systemPrompt, userPrompt) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');

    const model = "gpt-4.1-nano";

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ]
            })
        });

        if (!response.ok) {
            const errorBody = await response.text();
            console.warn(`OpenAI API call failed with status ${response.status}: ${errorBody}`);
            throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const messageContent = data.choices?.[0]?.message?.content;

        if (!messageContent) throw new Error("No content returned by OpenAI.");

        try {
            return JSON.parse(messageContent);
        } catch (parseError) {
            throw new Error("OpenAI returned unparseable JSON.");
        }

    } catch (error) {
        console.error("OpenAI API call failed:", error);
        throw error;
    }
}

// Main Netlify handler function
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { word, type, offset = 0, limit = 5, language, register = 'conversational' } = JSON.parse(event.body);

        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, language, limit);

        const apiResponse = await callOpenAIModel(systemPrompt, userPrompt);

        let responseData;
        if (type === 'generateExample') {
            responseData = apiResponse;
        } else {
            const allNodes = apiResponse.nodes || [];
            responseData = {
                nodes: allNodes,
                hasMore: allNodes.length === limit && allNodes.length > 0,
                total: null
            };
        }

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};