// lib/services/gemini.service.js
require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Verifica che la chiave API sia presente
if (!process.env.GEMINI_API_KEY) {
    throw new Error("FATAL ERROR: GEMINI_API_KEY non trovata nel file .env!");
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Funzione standard per generare un'analisi completa in un unico blocco.
 * @param {string} prompt - Il prompt completo da inviare a Gemini.
 * @returns {Promise<string>} La risposta testuale grezza dall'AI.
 */
async function generateAnalysis(prompt) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text();
    } catch (error) {
        console.error("[Gemini Service] Errore durante generateAnalysis:", error);
        throw new Error("Fallimento nella generazione dell'analisi AI.");
    }
}

// --- INIZIO BLOCCO NUOVO/VERIFICA ---

/**
 * [NUOVA FUNZIONE] Esegue la generazione del contenuto in modalità streaming.
 * Invece di restituire una Promise, invoca una callback per ogni chunk di testo ricevuto.
 * @param {string} prompt - Il prompt completo da inviare a Gemini.
 * @param {function(string, boolean, string)} onChunkReceived - Callback invocata con (chunk, isDone, fullText).
 */
async function streamAnalysis(prompt, onChunkReceived) {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const result = await model.generateContentStream(prompt);

        let fullText = '';
        for await (const chunk of result.stream) {
            // A volte i chunk possono essere vuoti, quindi li filtriamo
            if (chunk && chunk.text) {
                const chunkText = chunk.text();
                fullText += chunkText;
                // Invia il chunk parziale al chiamante
                onChunkReceived(chunkText, false, ''); 
            }
        }
        
        // Alla fine, invoca la callback un'ultima volta con lo stato 'done' e il testo completo.
        onChunkReceived('', true, fullText); 

    } catch (error) {
        console.error("[Gemini Service] Errore durante lo streaming dell'analisi:", error);
        // Propaga l'errore per gestirlo nell'endpoint del server
        throw new Error("Fallimento nello streaming dell'analisi AI.");
    }
}

// --- FINE BLOCCO NUOVO/VERIFICA ---


// --- CORREZIONE CRITICA (Aggiorna l'export) ---
module.exports = { 
    generateAnalysis,
    streamAnalysis // Assicurati che questa riga sia presente
};
// --- FINE CORREZIONE ---