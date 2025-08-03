// /netlify/functions/wordsplainer.js

const fetch = require('node-fetch');

// --- HELPERS ---

const cache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for dictionary data

function getCacheKey(word, type, language) {
    return `${word}-${type}-${language || 'en'}`;
}

function getCachedData(key) {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }
    cache.delete(key);
    return null;
}

function setCachedData(key, data) {
    cache.set(key, { data, timestamp: Date.now() });
}

// --- MODIFIED HELPER WITH FALLBACK LOGIC ---
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) throw new Error('API key is not configured.');

    // Define our primary and fallback models
    const primaryModel = "openai/gpt-4.1-nano"; 
    const fallbackModel = "mistralai/mistral-7b-instruct:free"; // Fixed missing semicolon

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

async function fetchFromFreeDictionary(word) {
    try {
        const response = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`);
        if (!response.ok) {
            console.log(`FreeDictionary API returned ${response.status} for word: ${word}`);
            return null;
        }
        const data = await response.json();
        return data[0]; // Return first entry
    } catch (error) {
        console.error('FreeDictionary API error:', error);
        return null;
    }
}

async function fetchFromDatamuse(query) {
    try {
        const response = await fetch(`https://api.datamuse.com/words?${query}&max=10`);
        if (!response.ok) {
            console.log(`Datamuse API returned ${response.status} for query: ${query}`);
            return [];
        }
        return await response.json();
    } catch (error) {
        console.error('Datamuse API error:', error);
        return [];
    }
}

function getLLMPrompt(type) {
    const prompts = {
        meaning: 'You are a dictionary. For the given word, provide ONE primary definition and two example sentences. Respond with a JSON object: {"nodes": [{"text": "definition here", "examples": ["example1", "example2"]}]}',
        context: 'You are a language expert. For the given word, list different contexts or domains where it is used. Respond with a JSON object: {"nodes": [{"text": "context1"}, {"text": "context2"}]}',
        derivatives: 'You are a linguist. For the given word, provide related word forms (e.g., noun, verb, adjective forms). For example, Love: "loving", "loved", "lovable". Respond with a JSON object: {"nodes": [{"text": "derivative1"}, {"text": "derivative2"}]}',
        collocations: 'You are a language expert. For the given word, provide common collocations (words that often appear with it). Respond with a JSON object: {"nodes": [{"text": "common collocation"}, {"text": "another one"}]}',        
        idioms: 'You are a language expert. For the given word, provide common idioms or phrases that use the word. Respond with a JSON object: {"nodes": [{"text": "an idiom here"}, {"text": "another idiom"}]}',        
        synonyms: 'You are a thesaurus. For the given word, provide up to 10 common synonyms. Respond with a JSON object: {"nodes": [{"text": "synonym1"}, {"text": "synonym2"}]}',
        opposites: 'You are a thesaurus. For the given word, provide up to 10 common antonyms (opposites). Respond with a JSON object: {"nodes": [{"text": "antonym1"}, {"text": "antonym2"}]}', 
    };
    return prompts[type] || prompts.meaning;
}

// --- MAIN HANDLER ---
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

    try {
        const { word, type, offset = 0, limit = 5, language, userWord, relationship, centralWord, context } = JSON.parse(event.body);

        // Cache check should be inside the handler
        const cacheKey = getCacheKey(word, type, language);
        let cachedResult = getCachedData(cacheKey);
        if (cachedResult) {
            return { statusCode: 200, body: JSON.stringify(cachedResult) };
        }

        // --- Route: On-Demand Example Generation ---
        if (type === 'generateExample') {
            let systemPrompt, userPrompt;
            
            if (centralWord && context) {
                systemPrompt = `You are a language teacher. Create an educational example sentence that:
                1. Uses "${centralWord}" in the context of "${context}"
                2. Shows natural, realistic usage
                Respond with JSON: {"example": "sentence"}`;
                userPrompt = `Central word: "${centralWord}", Context: "${context}"`;
            } else {
                systemPrompt = `Create an educational example sentence using "${word}" that:
                1. Shows common, natural usage
                2. Provides context clues for meaning
                Respond with JSON: {"example": "sentence"}`;
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
            case 'meaning':
                // Try FreeDictionary first, fallback to LLM
                const dictData = await fetchFromFreeDictionary(word);
                if (dictData && dictData.meanings) {
                    apiResponse.nodes = dictData.meanings.slice(0, 3).map(meaning => ({
                        text: `${meaning.partOfSpeech}: ${meaning.definitions[0].definition}`,
                        examples: meaning.definitions[0].example ? [meaning.definitions[0].example] : [],
                        partOfSpeech: meaning.partOfSpeech,
                        phonetic: dictData.phonetic
                    }));
                } else {
                    // Fallback to LLM
                    const llmSystemPrompt = getLLMPrompt(type);
                    apiResponse = await callOpenRouter(llmSystemPrompt, `Word: "${word}"`);
                }
                break;

            case 'derivatives':
                // Combine Datamuse with FreeDictionary data
                const apiResults = await fetchFromDatamuse(`rel_trg=${word}`);
                const dictEntry = await fetchFromFreeDictionary(word);
                
                let derivatives = apiResults.map(item => ({ text: item.word }));
                
                // Add word forms from FreeDictionary if available
                if (dictEntry && dictEntry.meanings) {
                    const existingWords = new Set(derivatives.map(d => d.text.toLowerCase()));
                    dictEntry.meanings.forEach(meaning => {
                        const wordForm = `${word} (${meaning.partOfSpeech})`;
                        if (!existingWords.has(wordForm.toLowerCase())) {
                            derivatives.push({ text: wordForm });
                        }
                    });
                }
                
                apiResponse.nodes = derivatives.slice(0, limit);
                break;

            case 'synonyms':
            case 'opposites':
            case 'collocations':
                let query;
                if (type === 'synonyms') query = `rel_syn=${word}`;
                else if (type === 'opposites') query = `rel_ant=${word}`;
                else if (type === 'collocations') query = `rel_jjb=${word}`; // Fixed: rel_col doesn't exist, use rel_jjb for adjectives or rel_trg for general
                
                const datamuseResults = await fetchFromDatamuse(query);
                
                if (datamuseResults.length > 0) {
                    apiResponse.nodes = datamuseResults.map(item => ({ text: item.word }));
                } else {
                    const systemPrompt = getLLMPrompt(type);
                    apiResponse = await callOpenRouter(systemPrompt, `Word: "${word}"`);
                }
                break;
            
            case 'translation':
                const systemPrompt = `You are a translator. For the word provided, give its main translation into the target language and an example sentence with their translations. Respond with a JSON object: {"nodes": [{"text": "translation"}], "exampleTranslations": {"english sentence": "foreign translation"}}`;
                const userPrompt = `Word: "${word}", Target Language Code: "${language}"`;
                apiResponse = await callOpenRouter(systemPrompt, userPrompt);
                break;

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

        // Cache the response before returning
        setCachedData(cacheKey, responseToSend);

        return { statusCode: 200, body: JSON.stringify(responseToSend) };

    } catch (error) {
        console.error("Function Error:", error);
        return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
    }
};