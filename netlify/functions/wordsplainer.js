// wordsplainer.js

const fetch = require('node-fetch');

function getLLMPrompt(type, register, word, options = {}) {
    const { 
        language = null, 
        limit = 5, 
        centralWord = null, 
        context = null, 
        sourceNodeType = null,
        definition = null,
        translation = null 
    } = options;

    const baseInstruction = `You are an expert English language tutor creating non-trivial engaging educational materials. The user is a language learner.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All generated content (word choices, definitions, examples, explanations, etc.) must use formal, precise language suitable for a university essay or research paper.`
        : `The user has selected the 'Conversational' register. All generated content (word choices, definitions, examples, explanations, etc.) must use natural, everyday language that would be heard in conversations.`;
    
    const finalFormatInstruction = `CRITICAL: Your entire response must be ONLY the valid JSON object specified in the task, with no extra text, commentary, or markdown formatting.`;

    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt = `Word: "${word}"`;
    let systemPrompt;

    switch(type) {
        case 'meaning':
            taskInstruction = `Provide engaging definitions for the main meanings of the word. For each, include its part of speech.\nJSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'context':
            taskInstruction = `List different contexts or domains where this word is commonly used.\nJSON format: {"nodes": [{"text": "Context/Domain Name"}]}`;
            break;
        case 'derivatives':
            taskInstruction = `Provide word forms (noun, verb, adjective, etc.). All word forms should have the same root.\nJSON format: {"nodes": [{"text": "derivative word", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'collocations':
            taskInstruction = `Provide words that often appear together with the target word.\nJSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;
        case 'idioms':
            taskInstruction = `Provide idioms or set phrases that use the word.\nJSON format: {"nodes": [{"text": "idiom phrase"}]}`;
            break;
        case 'synonyms':
        case 'opposites':
            const wordType = type === 'synonyms' ? 'synonyms' : 'antonyms (opposites)';
            taskInstruction = `Provide common ${wordType}.\nJSON format: {"nodes": [{"text": "the generated word here"}]}`;
            break;
        case 'translation':
            taskInstruction = `Provide the main translations for the word into the target language.\nJSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
        
        case 'generateExample':
            // This case handles its own more complex logic, which is fine.
            if (sourceNodeType === 'idioms') {
                taskInstruction = `The user clicked on an idiom. Create a single, high-quality example sentence using the idiom. Also, provide a brief, clear explanation of the idiom's meaning.\nJSON format: {"example": "The generated sentence.", "explanation": "The explanation of the idiom."}`;
                userPrompt = `Idiom to use and explain: "${word}"`;
            } else if (sourceNodeType === 'meaning' && centralWord && definition) {
                taskInstruction = `The user is exploring the word "${centralWord}" and clicked on this specific definition: "${definition}". Create a single, high-quality engaging example sentence that uses "${centralWord}" to clearly illustrate this exact meaning.\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Definition to illustrate: "${definition}"`;
            } else if (centralWord && context) {
                taskInstruction = `The user is exploring the word "${centralWord}" and has clicked on the context "${context}". Create a single, high-quality engaging example sentence that uses the word "${centralWord}" in a way that is specific to the field of "${context}".\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Context: "${context}"`;
            } else if (sourceNodeType === 'translation' && centralWord && translation && language) {
                taskInstruction = `The user is exploring the English word "${centralWord}". They clicked on its translation into ${language}: "${translation}". Create a single, high-quality engaging English example sentence using "${centralWord}". Then, provide its direct and natural translation into ${language}.\nJSON format: {"english_example": "The English sentence.", "translated_example": "The sentence in the target language."}`;
                userPrompt = `English Word: "${centralWord}", Target Language: "${language}", Translation: "${translation}"`;
            } else {
                taskInstruction = `Create a single, high-quality, engaging example sentence using the word provided in the user prompt. The sentence must clearly demonstrate the word's meaning in the specified register.\nJSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word to use in a sentence: "${word}"`;
            }
            // ⭐ FIX 3: Assemble the prompt for 'generateExample' using the new robust structure.
            systemPrompt = [baseInstruction, registerInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
            return { systemPrompt, userPrompt };

        default:
            throw new Error(`Unknown type: ${type}`);
    }

    // ⭐ FIX 4: Assemble the final system prompt with the format instruction at the end.
    systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

async function callOpenAIModel(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const model = "openai/gpt-oss-20b:free";

    try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
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


exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { word, type, offset = 0, limit = 5, language, register = 'conversational', centralWord, context, sourceNodeType, definition, translation } = JSON.parse(event.body);
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, { language, limit, centralWord, context, sourceNodeType, definition, translation });
        const apiResponse = await callOpenAIModel(systemPrompt, userPrompt);

        let responseData;
        if (type === 'generateExample') {
            responseData = apiResponse;
        } else {
            const rawNodes = apiResponse.nodes || [];

            const seen = new Set();
            const uniqueNodes = rawNodes.filter(node => {
                // Ensure the node and its text are valid before processing
                if (!node || typeof node.text !== 'string') {
                    return false;
                }
                const normalizedText = node.text.toLowerCase().trim();
                if (seen.has(normalizedText)) {
                    return false; // This is a duplicate, so filter it out
                } else {
                    seen.add(normalizedText);
                    return true; // This is a unique item, keep it
                }
            });

            responseData = {
                nodes: uniqueNodes,
                // The 'hasMore' logic is based on the original count from the LLM.
                // If it sent back the max number we requested, more might exist.
                hasMore: rawNodes.length === limit && rawNodes.length > 0,
                total: null
            };
        }

        return { statusCode: 200, body: JSON.stringify(responseData) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};