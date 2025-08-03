// /netlify/functions/wordsplainer.js
// FINAL, ROBUST VERSION WITH MODEL FALLBACK

const fetch = require('node-fetch');

// --- HELPERS ---

const cache = new Map();
const CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

// --- MODIFIED HELPER WITH FALLBACK LOGIC ---
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    // Define our primary and fallback models
    const primaryModel = "mistralai/mistral-small-3.2-24b-instruct:free";
    const fallbackModel = "google/gemma-7b-it:free"; // A reliable alternative

    let response;
    
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

        // If the primary model is unavailable (503), we'll let the catch block handle it
        if (!response.ok && response.status !== 503) {
            const errorBody = await response.text();
            throw new Error(`Primary model failed with status ${response.status}: ${errorBody}`);
        }
    } catch (error) {
        console.error(`Primary model error: ${error.message}.`);
        response = null; // Ensure response is null so we proceed to fallback
    }

    // --- TRY 2: Fallback Model (if primary failed or was unavailable) ---
    if (!response || !response.ok) {
        console.warn(`Primary model failed or was unavailable. Retrying with fallback: ${fallbackModel}`);
        response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                model: fallbackModel,
                response_format: { type: "json_object" },
                messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
            })
        });

        // If the fallback also fails, we throw a definitive error
        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`Fallback model also failed with status ${response.status}: ${errorBody}`);
        }
    }

    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}


async function fetchFromDatamuse(query) {
    const response = await fetch(`https://api.datamuse.com/words?${query}&max=10`);
    if (!response.ok) return [];
    return response.json();
}

function getLLMPrompt(type) {
    const prompts = {
        meaning: 'You are a dictionary. For the given word, provide ONE primary definition and two example sentences. Respond with a JSON object: {"nodes": [{"text": "definition here", "examples": ["example1", "example2"]}]}',
        synonyms: 'You are a thesaurus. For the given word, provide up to 10 common synonyms. Respond with a JSON object: {"nodes": [{"text": "synonym1"}, {"text": "synonym2"}]}',
        opposites: 'You are a thesaurus. For the given word, provide up to 10 common antonyms (opposites). Respond with a JSON object: {"nodes": [{"text": "antonym1"}, {"text": "antonym2"}]}',
        derivatives: 'You are a linguist. For the given word, provide related word forms (e.g., noun, verb, adjective forms). Respond with a JSON object: {"nodes": [{"text": "derivative1"}, {"text": "derivative2"}]}',
        collocations: 'You are a language expert. For the given word, provide common collocations (words that often appear with it). Respond with a JSON object: {"nodes": [{"text": "common collocation"}, {"text": "another one"}]}',
        idioms: 'You are a language expert. For the given word, provide common idioms or phrases that use the word. Respond with a JSON object: {"nodes": [{"text": "an idiom here"}, {"text": "another idiom"}]}',
        context: 'You are a language expert. For the given word, list different contexts or domains where it is used. Respond with a JSON object: {"nodes": [{"text": "context1"}, {"text": "context2"}]}',
    };
    return prompts[type] || prompts.meaning;
}

// --- MAIN HANDLER ---
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { word, type, offset = 0, limit = 5, language, userWord, relationship, centralWord } = JSON.parse(event.body);

        // --- Route: On-Demand Example Generation ---
        if (type === 'generateExample') {
            let systemPrompt, userPrompt;
            if (context && centralWord) {
                systemPrompt = `Create a single, clear example sentence using the 'centralWord' in the specified 'context'. Respond ONLY with a JSON object: {\"example\": \"The sentence goes here.\"}`;
                userPrompt = `Central Word: "${centralWord}", Context: "${context}"`;
            } else {
                systemPrompt = `Create a single, clear example sentence using the given word. Respond ONLY with a JSON object: {\"example\": \"The sentence goes here.\"}`;
                userPrompt = `Word: "${word}"`;
            }
            const exampleResponse = await callOpenRouter(systemPrompt, userPrompt);
            return { statusCode: 200, body: JSON.stringify(exampleResponse) };
        }
        
        // --- Route: Word Validation ---
        if (type === 'validate') {
             const systemPrompt = `You are a strict linguistic validator. Respond ONLY with a JSON object: {"isValid": boolean, "reason": "A brief explanation."}.`;
             const userPrompt = `Is "${userWord}" a valid example of a "${relationship}" for the word "${word}"?`;
             const validationResponse = await callOpenRouter(systemPrompt, userPrompt);
             return { statusCode: 200, body: JSON.stringify(validationResponse) };
        }
        
        // --- Route: Word Data Fetching ---
        let apiResponse = { nodes: [] };

        switch (type) {
            case 'synonyms':
            case 'opposites':
            case 'derivatives':
            case 'collocations':
                let query;
                if (type === 'synonyms') query = `rel_syn=${word}`;
                if (type === 'opposites') query = `rel_ant=${word}`;
                if (type === 'derivatives') query = `rel_trg=${word}`;
                if (type === 'collocations') query = `rel_col=${word}`;
                
                const apiResults = await fetchFromDatamuse(query);
                
                if (apiResults.length > 0) {
                    apiResponse.nodes = apiResults.map(item => ({ text: item.word }));
                } else {
                    const systemPrompt = getLLMPrompt(type);
                    apiResponse = await callOpenRouter(systemPrompt, `Word: "${word}"`);
                }
                break;
            
            case 'translation':
                const systemPrompt = `You are a translator. For the word provided, give its main translation into the target language and two example sentences with their translations. Respond with a JSON object: {"nodes": [{"text": "translation"}], "exampleTranslations": {"english sentence": "foreign translation"}}`;
                const userPrompt = `Word: "${word}", Target Language Code: "${language}"`;
                apiResponse = await callOpenRouter(systemPrompt, userPrompt);
                break;

            case 'meaning':
            case 'idioms':
            case 'context':
            default:
                const llmSystemPrompt = getLLMPrompt(type);
                apiResponse = await callOpenRouter(llmSystemPrompt, `Word: "${word}"`);
                break;
        }

        const allNodes = apiResponse.nodes || [];
        const total = allNodes.length;
        const responseToSend = {
            nodes: allNodes.slice(offset, offset + limit),
            hasMore: (offset + limit) < total,
            total: total,
            exampleTranslations: apiResponse.exampleTranslations || null
        };

        return { statusCode: 200, body: JSON.stringify(responseToSend) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};