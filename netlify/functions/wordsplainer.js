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

    const baseInstruction = `You are an expert linguist creating engaging explanations of English vocabulary in modern settings.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All generated content (word choices, definitions, examples, explanations, etc.) must use formal, precise language suitable for a university essay or research paper.`
        : `The user has selected the 'Conversational' register. All generated content (word choices, definitions, examples, explanations, etc.) must use natural, conversational colloquial language that native speakers would use in modern settings and natural situations.`;
    
    const finalFormatInstruction = `CRITICAL: Your entire response must be ONLY the valid JSON object specified in the task, with no extra text, commentary, or markdown formatting.`;

    const limitInstruction = `Provide up to ${limit} distinct items.`;

    let taskInstruction;
    let userPrompt = `Word: "${word}"`;
    let systemPrompt;

    switch(type) {
        case 'meaning':
            taskInstruction = `Provide non-trivial engaging definitions for the main meanings of the word. Use similes to explain complex concepts where appropriate. For each, include its part of speech.\nJSON format: {"nodes": [{"text": "definition here", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'context':
            taskInstruction = `List different contexts or domains where this word is commonly used.\nJSON format: {"nodes": [{"text": "Context/Domain Name"}]}`;
            break;
        case 'derivatives':
            taskInstruction = `Provide word forms (noun, verb, adjective, etc.). All word forms should have the same root.\nJSON format: {"nodes": [{"text": "derivative word", "part_of_speech": "e.g., noun, verb"}]}`;
            break;
        case 'collocations':
            taskInstruction = `Provide common collocations with the target word. CRITICAL: Each collocation phrase MUST contain the target word. For example, for the word "hand", you could provide "on the one hand" or "heavy hand". Include frequent noun, verb, adjective, and adverb pairings.\nJSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;
        case 'idioms':
            taskInstruction = `Provide idioms or set phrases. CRITICAL: Every single idiom you provide MUST contain the exact target word. Do not provide general proverbs. For example, for the word 'hand', a good idiom is "get out of hand".\nJSON format: {"nodes": [{"text": "idiom phrase"}]}`;
            break;
        case 'synonyms':
            taskInstruction = `Provide common synonyms for the target word. For example, for the word 'happy', you could provide 'joyful' or 'pleased'. The response should be single words. Do not provide definitions.\nJSON format: {"nodes": [{"text": "the synonym here"}]}`;
            break;
        case 'opposites':
            taskInstruction = `Provide common antonyms (opposites) for the target word. For example, for the word 'hot', you could provide 'cold' or 'cool'. The response should be single words. Do not provide definitions.\nJSON format: {"nodes": [{"text": "the antonym here"}]}`;
            break;        
        case 'translation':
            taskInstruction = `Provide the main translations for the word into the target language.\nJSON format: {"nodes": [{"text": "translation"}]}`;
            userPrompt = `Word: "${word}", Target Language: "${language}"`;
            break;
        
        case 'generateExample':
            if (sourceNodeType === 'idioms') {
                taskInstruction = `The user clicked on an idiom. Create a single, high-quality engaging example sentence using the idiom. Also, provide a brief, clear explanation of the idiom's meaning.\nJSON format: {"example": "The generated sentence.", "explanation": "The explanation of the idiom."}`;
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
            systemPrompt = [baseInstruction, registerInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
            return { systemPrompt, userPrompt };

        default:
            throw new Error(`Unknown type: ${type}`);
    }

    systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

async function callOpenRouterWithFallback(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const modelsToTry = [
        "openai/gpt-oss-20b:free",
        "google/gemini-2.0-flash-exp:free",
        "google/gemma-3-12b-it:free",
        "google/gemini-flash-1.5-8b",
        "mistralai/mistral-small-3.2-24b-instruct:free"
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
        const { word, type, register = 'conversational' } = body;
        
        const { systemPrompt, userPrompt } = getLLMPrompt(type, register, word, body);
        
        const apiResponse = await callOpenRouterWithFallback(systemPrompt, userPrompt);
        
        let responseData;
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