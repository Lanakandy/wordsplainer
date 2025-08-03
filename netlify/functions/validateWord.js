// /netlify/functions/validateWord.js
const fetch = require('node-fetch');

// This is the same LLM helper from wordsplainer.js.
// In a larger project, you might put this in a shared '/lib' folder.
async function callOpenRouter(systemPrompt, userPrompt) {
    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
        throw new Error('API key is not configured.');
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            "model": "openai/gpt-4o-mini",
            "response_format": { "type": "json_object" }, // Critical for reliable parsing
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

// Main handler for the validation function
exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        const { centralWord, userWord, relationship } = JSON.parse(event.body);

        if (!centralWord || !userWord || !relationship) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing required parameters.' }) };
        }

        // --- This is the new, highly specific prompt for our LLM referee ---
        const systemPrompt = `You are a strict linguistic validator. You will receive a central word, a user's word, and their supposed relationship (e.g., synonym, opposite). Determine if the user's word is a valid, common example of that relationship to the central word. Be critical. Respond ONLY with a JSON object with two keys: "isValid" (a boolean) and "reason" (a brief, one-sentence explanation for your decision). For example, if the central word is 'plan' and the user word is 'joy' for the relationship 'synonym', you must respond {"isValid": false, "reason": "'joy' is not a synonym for 'plan' as it relates to emotion, not organization."}.`;
        
        const userPrompt = `Central Word: "${centralWord}", User Word: "${userWord}", Relationship: "${relationship}"`;

        // Call the LLM and get its verdict
        const validationResponse = await callOpenRouter(systemPrompt, userPrompt);

        return {
            statusCode: 200,
            body: JSON.stringify(validationResponse) // e.g., {"isValid": false, "reason": "..."}
        };

    } catch (error) {
        console.error("Error in validateWord function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message || 'An internal server error occurred.' })
        };
    }
};