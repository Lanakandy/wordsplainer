// /netlify/functions/wordsplainer.js (UPDATED FOR MODELS WITHOUT JSON MODE)

const fetch = require('node-fetch');

async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

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
            // You can now use your desired model, even if it doesn't support json_object
            "model": "google/gemma-3-12b-it:free", 
            
            // CHANGE 1: The "response_format" line has been REMOVED.
            
            "messages": [
                { "role": "system", "content": systemPrompt },
                { "role": "user", "content": userPrompt }
            ]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenRouter API Error:", errorBody);
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    // Because we are no longer guaranteed JSON, we add a safety check.
    try {
        return JSON.parse(data.choices[0].message.content);
    } catch (e) {
        console.error("AI did not return valid JSON:", data.choices[0].message.content);
        throw new Error("The AI response was not in the correct format. Please try again.");
    }
}


// CHANGE 2: Prompts are now more forceful about the JSON-only requirement.
function getSystemPrompts(type, language = null) {
    const baseFormat = 'You are a linguistic data expert. You MUST respond with a raw JSON object, without any surrounding text, explanations, or markdown code fences like ```json. The JSON object must contain a "nodes" array. Each object in the "nodes" array should have a "text" property.';

    const prompts = {
        meaning: `You are an English dictionary assistant. You will be given a word. Respond ONLY with a raw JSON object. This object must have a "nodes" array. Inside this array, provide ONE object containing the primary definition in a "text" property and a "examples" array with two distinct, lowercase example sentences. Example for "happy": {"nodes": [{"text": "feeling or showing pleasure or contentment.", "examples": ["she was happy to be home", "a happy coincidence"]}]}`,
        synonyms: `${baseFormat} The "nodes" should contain objects with common synonyms for the given word.`,
        opposites: `${baseFormat} The "nodes" should contain objects with common antonyms (opposites) for the given word.`,
        derivatives: `${baseFormat} The "nodes" should contain objects with related words or derivatives (e.g., for "plan", return "planning", "planner").`,
        collocations: `${baseFormat} The "nodes" should contain objects with common collocations (words that frequently appear together).`,
        idioms: `${baseFormat} The "nodes" should contain objects with common idioms that include the given word.`,
        context: `${baseFormat} The "nodes" should contain single-word contexts or domains where the given word is commonly used (e.g., for "plan", return "business", "strategy").`,
        translation: `You are a translator. You will be given a word and a target language code ('${language}'). Respond ONLY with a raw JSON object. It must contain a "nodes" array with ONE object with the translation in a "text" property. It must also have an "exampleTranslations" object. Keys should be English sentences, values should be their translations. Example for word "plan", language "es": {"nodes":[{"text":"el plan"}], "exampleTranslations":{"the plan was to meet at the cafe":"el plan era encontrarse en el café","do you have a backup plan?":"¿tienes un plan de respaldo?"}}`
    };

    return prompts[type];
}


// The rest of the handler function remains the same.
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }
    try {
        const { word, type, offset = 0, limit = 5, language } = JSON.parse(event.body);
        const systemPrompt = getSystemPrompts(type, language);
        if (!systemPrompt) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Invalid data type requested.' }) };
        }
        let userPrompt;
        if (type === 'translation') {
            userPrompt = `Translate the word "${word}" to the language with code "${language}". Use these English sentences for context: "the plan was to meet at the cafe" and "do you have a backup plan?".`;
        } else {
            userPrompt = `Word: "${word}"`;
        }
        const aiResponse = await callOpenRouter(systemPrompt, userPrompt);
        const allNodes = aiResponse.nodes || [];
        const total = allNodes.length;
        const paginatedNodes = allNodes.slice(offset, offset + limit);
        const hasMore = (offset + limit) < total;
        const response = {
            nodes: paginatedNodes,
            hasMore: hasMore,
            total: total,
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