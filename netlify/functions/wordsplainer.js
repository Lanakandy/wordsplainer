// /netlify/functions/wordsplainer.js
// This file is now the single source of truth for your backend logic.

const fetch = require('node-fetch');

// --- START: CACHE & RATE LIMIT SETUP ---
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30;

function getCacheKey(word, type, language) {
    return `${word.toLowerCase()}:${type}:${language || 'en'}`;
}
// --- END: CACHE & RATE LIMIT SETUP ---


// --- START: API & LLM HELPERS ---
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            "model": "mistralai/mistral-small-3.2-24b-instruct:free",
            "response_format": { "type": "json_object" },
            "messages": [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": userPrompt }]
        })
    });

    if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenRouter API Error:", errorBody);
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
    }
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

async function fetchFromDatamuse(query) {
    const response = await fetch(`https://api.datamuse.com/words?${query}&max=10`);
    if (!response.ok) throw new Error(`Datamuse request failed with status ${response.status}`);
    return response.json();
}
// --- END: API & LLM HELPERS ---


// --- MAIN HANDLER ---
exports.handler = async function(event) {
    // Standard headers for all responses
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 204, headers };
    }
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        // Rate Limiting
        const ip = event.headers['x-forwarded-for']?.split(',')[0] || '127.0.0.1';
        const userRequests = (rateLimits.get(ip) || []).filter(time => Date.now() - time < RATE_LIMIT_WINDOW_MS);
        if (userRequests.length >= RATE_LIMIT_MAX_REQUESTS) {
            return { statusCode: 429, headers, body: JSON.stringify({ error: 'Too Many Requests' }) };
        }
        userRequests.push(Date.now());
        rateLimits.set(ip, userRequests);

        const { word, type, offset = 0, limit = 5, language, userWord, relationship } = JSON.parse(event.body);

        // --- ROUTE 1: Word Validation Logic ---
        if (type === 'validate') {
            const systemPrompt = `You are a strict linguistic validator. You will receive a central word, a user's word, and their supposed relationship (e.g., synonym, opposite). Determine if the user's word is a valid, common example of that relationship to the central word. Be critical. Respond ONLY with a JSON object with two keys: "isValid" (a boolean) and "reason" (a brief, one-sentence explanation for your decision).`;
            const userPrompt = `Central Word: "${word}", User Word: "${userWord}", Relationship: "${relationship}"`;
            const validationResponse = await callOpenRouter(systemPrompt, userPrompt);
            return { statusCode: 200, headers, body: JSON.stringify(validationResponse) };
        }

        // --- ROUTE 2: Word Data Fetching Logic ---
        const cacheKey = getCacheKey(word, type, language);
        if (cache.has(cacheKey)) {
            console.log(`CACHE HIT for key: ${cacheKey}`);
            const cachedData = cache.get(cacheKey);
            // Paginate from the cached full dataset
            const paginatedNodes = cachedData.nodes.slice(offset, offset + limit);
            const response = { ...cachedData, nodes: paginatedNodes, hasMore: (offset + limit) < cachedData.total };
            return { statusCode: 200, headers, body: JSON.stringify(response) };
        }
        console.log(`CACHE MISS for key: ${cacheKey}`);
        
        let apiResponse;
        
        // Use real APIs for factual data
        if (['synonyms', 'opposites', 'collocations'].includes(type)) {
            let query;
            if (type === 'synonyms') query = `rel_syn=${word}`;
            if (type === 'opposites') query = `rel_ant=${word}`;
            if (type === 'collocations') query = `rel_col=${word}`; // Datamuse is great for collocations
            const results = (await fetchFromDatamuse(query)).map(item => ({ text: item.word }));
            apiResponse = { nodes: results };
        } else { // Use LLM for generative/creative tasks
            let systemPrompt, userPrompt;
            if (type === 'idioms') {
                systemPrompt = 'You are a linguistic expert. Respond with a JSON object containing a "nodes" array. The "nodes" should contain objects with common idioms that include the given word.';
                userPrompt = `Word: "${word}"`;
            } else if (type === 'translation' && language) {
                systemPrompt = `You are a translator. You will be given a word and a target language code. Respond with a JSON object containing a "nodes" array with ONE object with the primary translation. Additionally, provide an "exampleTranslations" object. Keys are English example sentences, values are their translations.`;
                userPrompt = `Translate the word "${word}" to language code "${language}". Provide two example sentences.`;
            }
             else { // Fallback for meaning, context, etc.
                 systemPrompt = 'You are a dictionary assistant. Provide a definition and two examples for the given word. Respond with a JSON object: {"nodes": [{"text": "definition", "examples": ["example1", "example2"]}]}';
                 userPrompt = `Word: "${word}"`;
            }
            apiResponse = await callOpenRouter(systemPrompt, userPrompt);
        }

        // --- Universal Response Handling ---
        const allNodes = apiResponse.nodes || [];
        const total = allNodes.length;
        const fullResponse = {
            nodes: allNodes,
            total: total,
            exampleTranslations: apiResponse.exampleTranslations,
        };

        cache.set(cacheKey, fullResponse); // Cache the full, unpaginated response
        
        // Paginate for the final send-off
        const paginatedNodes = allNodes.slice(offset, offset + limit);
        const responseToSend = { ...fullResponse, nodes: paginatedNodes, hasMore: (offset + limit) < total };

        return { statusCode: 200, headers, body: JSON.stringify(responseToSend) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, headers, body: JSON.stringify({ error: error.message || 'An internal server error occurred.' }) };
    }
};