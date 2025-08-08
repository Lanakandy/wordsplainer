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

    const baseInstruction = `You are an expert linguist creating engaging explanations of English vocabulary.`;

    const registerInstruction = register === 'academic' 
        ? `The user has selected the 'Academic' register. All generated content (word choices, definitions, examples, explanations, etc.) must use formal, precise language suitable for a university essay or research paper.`
        : `The user has selected the 'Conversational' register. All generated content (word choices, definitions, examples, explanations, etc.) must use natural, conversational colloquial language that native speakers would use.`;
    
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
            taskInstruction = `Provide common collocations with the target word. Include frequent noun, verb, adjective, adverb, and preposition pairings that naturally occur with it.\nJSON format: {"nodes": [{"text": "collocation phrase"}]}`;
            break;
        case 'idioms':
            taskInstruction = `Provide idioms or set phrases that use the target word. All idiom phrases should have the target word in them.\nJSON format: {"nodes": [{"text": "idiom phrase"}]}`;
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
            // Assemble the prompt for 'generateExample' using the new robust structure.
            systemPrompt = [baseInstruction, registerInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
            return { systemPrompt, userPrompt };

        default:
            throw new Error(`Unknown type: ${type}`);
    }

    // Assemble the final system prompt with the format instruction at the end.
    systemPrompt = [baseInstruction, registerInstruction, limitInstruction, taskInstruction, finalFormatInstruction].join('\n\n');
    return { systemPrompt, userPrompt };
}

async function callOpenRouterWithFallback(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    // Define a list of models to try in order of preference.
    const modelsToTry = [
        "mistralai/mistral-small-3.2-24b-instruct:free",
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
            // ⭐ FIX: Normalize and clean the node data from the API
            let allNodes = apiResponse.nodes || [];
            const typesToNormalize = ['synonyms', 'opposites', 'derivatives']; // Add other types if needed

            if (typesToNormalize.includes(type)) {
                allNodes = allNodes
                    .map(node => ({
                        ...node,
                        // Ensure all text is lowercase for consistency
                        text: node.text.toLowerCase() 
                    }))
                    // Remove any node that is identical to the original word
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