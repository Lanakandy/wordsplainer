// wordsplainer.js

const fetch = require('node-fetch');

// ⭐ MODIFICATION: The options object is now fully comprehensive.
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

    const baseInstruction = `You are an expert English language tutor creating educational materials. Your tone is encouraging and clear. The user is a language learner. For the given request, provide a response STRICTLY in the specified JSON object format. Do not include any other text, explanations, or apologies outside of the JSON structure.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All definitions, examples, and explanations must use formal, precise language suitable for a university essay, research paper, or formal presentation. Focus on nuance and sophisticated vocabulary.`
        : `The user has selected the 'Conversational' register. All definitions, examples, and explanations must use natural, everyday language that would be heard in conversations. Use common phrasings and contractions where appropriate.`;
    
    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt;
    let systemPrompt;

    switch(type) {
        // ... (cases 'meaning' through 'opposites' are unchanged) ...
        case 'meaning':
            taskInstruction = `Provide definitions for the main meanings of the word. For each, include its part of speech.
            JSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb"}]}`;
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
            taskInstruction = `Provide common idioms or phrases that use the word.
            JSON format: {"nodes": [{"text": "idiom phrase"}]}`;
            break;
        case 'synonyms':
        case 'opposites':
            const wordType = type === 'synonyms' ? 'synonyms' : 'antonyms (opposites)';
            taskInstruction = `Provide common ${wordType}.
            JSON format: {"nodes": [{"text": "synonym/antonym"}]}`;
            break;

        // ⭐ MODIFICATION: The 'translation' case is now only for listing translations.
        case 'translation':
            taskInstruction = `Provide the main translations for the word into the target language.
            JSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
        
        // ⭐ MODIFICATION: 'generateExample' is now the central hub for all example types.
        case 'generateExample':
            // Case 1: Example for an idiom.
            if (sourceNodeType === 'idioms') {
                taskInstruction = `The user clicked on an idiom. Create a single, high-quality example sentence using the idiom. Also, provide a brief, clear explanation of the idiom's meaning.
                JSON format: {"example": "The generated sentence.", "explanation": "The explanation of the idiom."}`;
                userPrompt = `Idiom to use and explain: "${word}"`;
            }
            // Case 2: Example for a specific meaning/definition.
            else if (sourceNodeType === 'meaning' && centralWord && definition) {
                taskInstruction = `The user is exploring the word "${centralWord}" and clicked on this specific definition: "${definition}". Create a single, high-quality example sentence that uses "${centralWord}" to clearly illustrate this exact meaning.
                JSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Definition to illustrate: "${definition}"`;
            }
            // Case 3: Example for a specific context.
            else if (centralWord && context) {
                taskInstruction = `The user is exploring the word "${centralWord}" and has clicked on the context "${context}". Create a single, high-quality example sentence that uses the word "${centralWord}" in a way that is specific to the field of "${context}".
                JSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word: "${centralWord}", Context: "${context}"`;
            }
            // Case 4: Bilingual example for a translation.
            else if (sourceNodeType === 'translation' && centralWord && translation && language) {
                taskInstruction = `The user is exploring the English word "${centralWord}". They clicked on its translation into ${language}: "${translation}". Create a single, high-quality English example sentence using "${centralWord}". Then, provide its direct and natural translation into ${language}.
                JSON format: {"english_example": "The English sentence.", "translated_example": "The sentence in the target language."}`;
                userPrompt = `English Word: "${centralWord}", Target Language: "${language}", Translation: "${translation}"`;
            }
            // Case 5: A standard example for any other word/phrase.
            else {
                taskInstruction = `Create a single, high-quality, educational example sentence using the word provided in the user prompt. The sentence must clearly demonstrate the word's meaning in the specified register.
                JSON format: {"example": "The generated sentence."}`;
                userPrompt = `Word to use in a sentence: "${word}"`;
            }
            systemPrompt = [baseInstruction, registerInstruction, taskInstruction].join('\n\n');
            return { systemPrompt, userPrompt };

        default:
            throw new Error(`Unknown type: ${type}`);
    }

    systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}


// ... callOpenAIModel function is unchanged ...
async function callOpenAIModel(systemPrompt, userPrompt) {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_API_KEY) throw new Error('OpenAI API key is not configured.');

    const model = "gpt-3.5-turbo";

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


// ⭐ MODIFICATION: The handler now extracts and passes all possible new parameters.
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // Extract all possible properties from the request body
        const { word, type, offset = 0, limit = 5, language, register = 'conversational', centralWord, context, sourceNodeType, definition, translation } = JSON.parse(event.body);

        // Pass them all in the new options object
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, { language, limit, centralWord, context, sourceNodeType, definition, translation });

        const apiResponse = await callOpenAIModel(systemPrompt, userPrompt);

        // This part remains the same and correctly handles all response types
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