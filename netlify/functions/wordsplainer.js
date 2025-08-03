// /netlify/functions/wordsplainer.js
// FINAL, ROBUST VERSION

const fetch = require('node-fetch');

// --- HELPERS (No changes here) ---

const cache = new Map();
const CACHE_TTL_MS = 1 * 60 * 60 * 1000; // 1 hour

async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            model: "mistralai/mistral-small-3.2-24b-instruct:free",
            response_format: { type: "json_object" },
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }]
        })
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenRouter API Error:", errorBody);
        throw new Error(`API request failed: ${errorBody}`);
    }
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

async function fetchFromDatamuse(query) {
    const response = await fetch(`https://api.datamuse.com/words?${query}&max=10`);
    if (!response.ok) return []; // Return empty on error instead of throwing
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
        context: 'You are a language expert. For the given word, list different contexts or domains where it is used (e.g., for "pitch", contexts could be "music", "baseball", "sales"). Respond with a JSON object: {"nodes": [{"text": "context1"}, {"text": "context2"}]}',
    };
    return prompts[type] || prompts.meaning; // Default to meaning
}

// --- MAIN HANDLER ---
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { word, type, offset = 0, limit = 5, language, userWord, relationship } = JSON.parse(event.body);

        // --- ROUTE 1: Word Validation ---
        if (type === 'validate') {
             const systemPrompt = `You are a strict linguistic validator. Respond ONLY with a JSON object: {"isValid": boolean, "reason": "A brief explanation."}.`;
             const userPrompt = `Is "${userWord}" a valid example of a "${relationship}" for the word "${word}"?`;
             const validationResponse = await callOpenRouter(systemPrompt, userPrompt);
             return { statusCode: 200, body: JSON.stringify(validationResponse) };
        }
        
        // --- ROUTE 2: Word Data Fetching ---
        let apiResponse = { nodes: [] };

        // This switch handles every case explicitly.
        switch (type) {
            case 'synonyms':
            case 'opposites':
            case 'derivatives': // Was missing
            case 'collocations':
                let query;
                if (type === 'synonyms') query = `rel_syn=${word}`;
                if (type === 'opposites') query = `rel_ant=${word}`;
                if (type === 'derivatives') query = `rel_trg=${word}`; // Datamuse code for derivatives
                if (type === 'collocations') query = `rel_col=${word}`;
                
                const apiResults = await fetchFromDatamuse(query);
                
                if (apiResults.length > 0) {
                    console.log(`SUCCESS: Found ${apiResults.length} ${type} for "${word}" via Datamuse.`);
                    apiResponse.nodes = apiResults.map(item => ({ text: item.word }));
                } else {
                    // FALLBACK TO LLM
                    console.log(`INFO: Datamuse had no ${type} for "${word}". Falling back to LLM.`);
                    const systemPrompt = getLLMPrompt(type);
                    apiResponse = await callOpenRouter(systemPrompt, `Word: "${word}"`);
                }
                break;
            
            case 'translation':
                // This is always LLM-driven
                const systemPrompt = `You are a translator. For the word provided, give its main translation into the target language and two example sentences with their translations. Respond with a JSON object: {"nodes": [{"text": "translation"}], "exampleTranslations": {"english sentence": "foreign translation"}}`;
                const userPrompt = `Word: "${word}", Target Language Code: "${language}"`;
                apiResponse = await callOpenRouter(systemPrompt, userPrompt);
                break;

            case 'meaning':
            case 'idioms':
            case 'context': // Was missing
            default:
                // These types are better suited for the LLM directly.
                console.log(`INFO: Using LLM for type "${type}" for word "${word}".`);
                const llmSystemPrompt = getLLMPrompt(type);
                apiResponse = await callOpenRouter(llmSystemPrompt, `Word: "${word}"`);
                break;
        }

        // --- Universal Response Handling ---
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