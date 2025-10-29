// lib/services/gemini.service.js
import { GoogleGenerativeAI } from '@google/generative-ai';

const log = (msg) => process.stderr.write(`${msg}\n`);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// MODELLO E CONFIGURAZIONE
const MODEL_NAME = "gemini-1.5-flash-latest"; // Usa 'latest' per gli ultimi aggiornamenti
const generationConfig = {
    responseMimeType: "text/plain", // <-- FORZA L'OUTPUT IN TESTO PURO
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateAnalysis(prompt) {
    const MAX_RETRIES = 3; // Ridotto a 3 per un fallback più veloce
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ 
                model: MODEL_NAME,
                generationConfig, // Applica la configurazione
            });

            // Rimosso il prompt wrapper che forzava il JSON
            const result = await model.generateContent(prompt);

            const response = await result.response;
            return response.text();

        } catch (error) {
            lastError = error;
            if (error.status === 503 || error.message?.includes('503')) {
                const waitTime = Math.pow(2, attempt) * 1000;
                log(`[GeminiService] Tentativo ${attempt + 1}/${MAX_RETRIES} fallito (503). Riprovo in ${waitTime / 1000}s...`);
                if (attempt < MAX_RETRIES - 1) {
                    await delay(waitTime);
                    continue;
                }
            }
            log(`[GeminiService] ❌ ERRORE: ${error.message}`);
            // Non rilanciare l'errore subito, completa i tentativi
        }
    }
    
    throw new Error(`AI generation failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || 'Unknown'}`);
}

export { generateAnalysis };