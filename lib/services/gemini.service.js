// lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';

// Inizializzazione del client con la chiave API da .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Modello di produzione stabile
const MODEL_NAME = "gemini-2.5-flash";

/**
 * Funzione di utilità per ritardare l'esecuzione.
 * @param {number} ms - Millisecondi da attendere.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Genera un'analisi utilizzando il modello Gemini con logica di retry.
 * @param {string} prompt - Il prompt completo da inviare al modello.
 * @returns {Promise<string>} La risposta JSON grezza del modello.
 */
async function generateAnalysis(prompt) {
    const MAX_RETRIES = 5;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // Ottieni il modello
            const model = genAI.getGenerativeModel({ 
                model: MODEL_NAME
            });

            // Prepara il prompt con istruzioni incorporate
            const fullPrompt = `Sei un analista AI. La tua unica uscita deve essere un oggetto JSON valido, come richiesto, senza testo aggiuntivo o preamboli.\n\n${prompt}`;

            // Genera il contenuto
            const result = await model.generateContent(fullPrompt);

            const response = await result.response;
            return response.text();

        } catch (error) {
            lastError = error;

            // Logica di Exponential Backoff per errori 503
            if (error.status === 503 || error.message?.includes('503')) {
                const waitTime = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                console.warn(`[GeminiService] Tentativo ${attempt + 1}/${MAX_RETRIES} fallito (503). Riprovo in ${Math.round(waitTime / 1000)}s...`);
               
                if (attempt < MAX_RETRIES - 1) {
                    await delay(waitTime);
                    continue;
                }
            }
           
            console.error("[GeminiService] ERRORE durante la generazione:", error.message);
            throw new Error(`Failed to generate content from AI service: ${error.message}`);
        }
    }
   
    throw new Error(`Failed to generate content after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || 'Unknown Error'}`);
}

// In questo caso, generateEmbeddings non è presente, quindi esportiamo solo generateAnalysis.
// Se generateEmbeddings fosse stata definita (ad esempio come const generateEmbeddings = async () => {...}), avrei esportato anche quella.
export { generateAnalysis };