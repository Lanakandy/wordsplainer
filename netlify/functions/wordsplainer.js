// /netlify/functions/wordsplainer.js
const fetch = require('node-fetch');

// --- START: CACHE SETUP ---
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getCacheKey(word, type, language) {
    return `${word.toLowerCase()}:${type}:${language || 'en'}`;
}
// --- END: CACHE SETUP ---


// --- LLM HELPER (Full version, including API key check) ---
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    
    // This check is essential and correctly included here.
    if (!OPENROUTER_API_KEY) {
        throw new Error('API key is not configured.');
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            "model": "openai/gpt-4o-mini",
            "response_format": { "type": "json_object" },
            "messages": [{ "role": "system", "content": systemPrompt }, { "role": "user", "content": userPrompt }]
        })
    });
    if (!response.ok) {
        const errorBody = await response.text();
        console.error("OpenRouter API Error:", errorBody);
        throw new Error(`API request failed with status ${response.status}`);
    }
    const data = await response.json();
    return JSON.parse(data.choices[0].message.content);
}

function getSystemPrompts(type, language = null) {
    const prompts = {
        idioms: 'You are a linguistic data expert. You will be given a word and must respond with a JSON object containing a "nodes" array. The "nodes" should contain objects with common idioms that include the given word.',
        translation: `You are a translator. You will be given a word and a target language code ('${language}'). Respond with a JSON object containing a "nodes" array. Inside, provide ONE object with the primary translation in the "text" property. Additionally, provide an "exampleTranslations" object. Keys are English example sentences, values are their translations into '${language}'.
        Example for word "plan", language "es":
        {"nodes":[{"text":"el plan"}], "exampleTranslations":{"the plan was to meet at the cafe":"el plan era encontrarse en el café","do you have a backup plan?":"¿tienes un plan de respaldo?"}}`
    };
    return prompts[type];
}


// --- API HELPERS (Full versions) ---
async function fetchFromDictionaryAPI(word) {
    const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
    if (!response.ok) {
        if (response.status === 404) return null;
        throw new Error(`DictionaryAPI request failed with status ${response.status}`);
    }
    const data = await response.json();
    return data[0];
}

async function fetchFromDatamuse(query) {
    const response = await fetch(`https://api.datamuse.com/words?${query}`);
    if (!response.ok) throw new Error(`Datamuse request failed with status ${response.status}`);
    return response.json();
}

// --- MAIN HANDLER ---
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { word, type, offset = 0, limit = 5, language } = JSON.parse(event.body);

        // --- CACHE CHECK ---
        const cacheKey = getCacheKey(word, type, language);
        if (cache.has(cacheKey)) {
            const cachedItem = cache.get(cacheKey);
            if (Date.now() - cachedItem.timestamp < CACHE_TTL_MS) {
                console.log(`CACHE HIT for key: ${cacheKey}`);
                const allNodes = cachedItem.data.nodes || [];
                const total = allNodes.length;
                const paginatedNodes = allNodes.slice(offset, offset + limit);
                const hasMore = (offset + limit) < total;

                const response = {
                    nodes: paginatedNodes,
                    hasMore: hasMore,
                    total: total,
                    exampleTranslations: cachedItem.data.exampleTranslations
                };
                
                return { statusCode: 200, body: JSON.stringify(response) };
            }
        }
        
        console.log(`CACHE MISS for key: ${cacheKey}`);
        
        let apiResponse;
        
        const apiDrivenTypes = ['meaning', 'synonyms', 'opposites', 'derivatives', 'collocations', 'context'];
        if (apiDrivenTypes.includes(type)) {
            let results = [];
            switch (type) {
                case 'meaning':
                    const dictData = await fetchFromDictionaryAPI(word);
                    if (dictData && dictData.meanings) {
                        const firstMeaning = dictData.meanings[0];
                        const firstDefinition = firstMeaning.definitions[0];
                        if (firstDefinition) {
                            results.push({
                                text: `(${firstMeaning.partOfSpeech}) ${firstDefinition.definition}`,
                                examples: firstDefinition.example ? [firstDefinition.example] : []
                            });
                        }
                    }
                    break;
                case 'synonyms':
                    const synData = await fetchFromDatamuse(`rel_syn=${word}`);
                    results = synData.map(item => ({ text: item.word }));
                    break;
                case 'opposites':
                    const oppData = await fetchFromDatamuse(`rel_ant=${word}`);
                    results = oppData.map(item => ({ text: item.word }));
                    break;
                case 'derivatives':
                    const derData = await fetchFromDatamuse(`rel_trg=${word}`);
                    results = derData.map(item => ({ text: item.word }));
                    break;
                case 'collocations':
                    const colData = await fetchFromDatamuse(`rel_col=${word}`);
                    results = colData.map(item => ({ text: item.word }));
                    break;
                case 'context':
                    const topicData = await fetchFromDatamuse(`topics=${word}`);
                    results = topicData.map(item => ({ text: item.word }));
                    break;
            }
            apiResponse = { nodes: results };
        } else {
            const systemPrompt = getSystemPrompts(type, language);
            if (!systemPrompt) {
                return { statusCode: 400, body: JSON.stringify({ error: 'Invalid data type requested.' }) };
            }
            const userPrompt = type === 'translation' 
                ? `Translate the word "${word}" to language "${language}". Use context sentences: "the plan was to meet at the cafe" and "do you have a backup plan?".`
                : `Word: "${word}"`;
            
            apiResponse = await callOpenRouter(systemPrompt, userPrompt);
        }

        // --- CACHE STORE ---
        if (apiResponse && apiResponse.nodes && apiResponse.nodes.length > 0) {
            cache.set(cacheKey, { data: apiResponse, timestamp: Date.now() });
            console.log(`CACHE SET for key: ${cacheKey}`);
        }

        const allNodes = apiResponse.nodes || [];
        const total = allNodes.length;
        const paginatedNodes = allNodes.slice(offset, offset + limit);
        const hasMore = (offset + limit) < total;

        const response = {
            nodes: paginatedNodes,
            hasMore: hasMore,
            total: total,
            exampleTranslations: apiResponse.exampleTranslations
        };

        return { statusCode: 200, body: JSON.stringify(response) };

    } catch (error) {
        console.error("Error in wordsplainer function:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message || 'An internal server error occurred.' }) };
    }
};