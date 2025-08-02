// /netlify/functions/wordsplainer.js

// This is a more advanced "mock" backend that provides the data
// in the exact structure your sophisticated frontend script expects.

// Mock data store
const wordData = {
    'plan': {
        meaning: [{ text: 'a detailed proposal for doing or achieving something.', examples: ["the plan was to meet at the cafe", "do you have a backup plan?"] }],
        context: [{ text: 'business' }, { text: 'strategy' }, { text: 'project' }],
        derivatives: [{ text: 'planning' }, { text: 'planned' }, { text: 'planner' }, { text: 'unplanned' }],
        synonyms: [{ text: 'scheme' }, { text: 'strategy' }, { text: 'blueprint' }, { text: 'design' }, { text: 'proposal' }, { text: 'intention' }],
        collocations: [{ text: 'make a plan' }, { text: 'stick to the plan' }, { text: 'a cunning plan' }, { text: 'draw up a plan' }],
    },
    'happy': {
        meaning: [{ text: 'feeling or showing pleasure or contentment.', examples: ["she was happy to be home", "a happy coincidence"] }],
        synonyms: [{ text: 'cheerful' }, { text: 'joyful' }, { text: 'elated' }, { text: 'gleeful' }, { text: 'content' }],
        opposites: [{ text: 'sad' }, { text: 'unhappy' }, { text: 'miserable' }],
        derivatives: [{ text: 'happiness' }, { text: 'happily' }],
        idioms: [{ text: 'happy-go-lucky' }, { text: 'happy camper' }, { text: 'happy medium' }],
    },
    // Add more words here for testing
};

// Mock translation data
const translationData = {
    'plan': { es: 'el plan', fr: 'le plan', de: 'der Plan' },
    'happy': { es: 'feliz', fr: 'heureux', de: 'glücklich' }
};

const exampleTranslationData = {
    "the plan was to meet at the cafe": { es: "el plan era encontrarse en el café", fr: "le plan était de se retrouver au café" },
    "she was happy to be home": { es: "ella estaba feliz de estar en casa", fr: "elle était contente d'être à la maison" }
};


exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { word, type, offset = 0, limit = 5, language } = JSON.parse(event.body);
        const lowerWord = word.toLowerCase();

        // --- Translation Logic ---
        if (type === 'translation' && language) {
            const translation = translationData[lowerWord]?.[language] || 'N/A';
            return {
                statusCode: 200,
                body: JSON.stringify({
                    nodes: [{ 
                        text: translation, 
                        // This matches the complex structure your frontend expects
                        translationData: translationData[lowerWord] 
                    }],
                    exampleTranslations: exampleTranslationData,
                    hasMore: false,
                    total: 1
                })
            };
        }

        // --- Standard Data Logic ---
        const allNodes = wordData[lowerWord]?.[type] || [];
        const total = allNodes.length;

        // Apply pagination
        const paginatedNodes = allNodes.slice(offset, offset + limit);
        const hasMore = (offset + limit) < total;

        const response = {
            nodes: paginatedNodes,
            hasMore: hasMore,
            total: total
        };

        return {
            statusCode: 200,
            body: JSON.stringify(response)
        };

    } catch (error) {
        console.error("Error in wordsplainer function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'An internal error occurred.' })
        };
    }
};