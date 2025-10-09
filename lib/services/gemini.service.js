// lib/services/gemini.service.js

// Importazione corretta e inizializzazione del client AI
const { GoogleGenAI } = require('@google/generative-ai');

// Inizializzazione del client con la chiave API da .env
const ai = new GoogleGenAI(process.env.GEMINI_API_KEY);
const modelName = "gemini-2.5-flash"; // Usiamo il modello corretto

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
    const MAX_RETRIES = 5; // Numero massimo di tentativi
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            // Configurazione per ricevere JSON strutturato.
            // Non usiamo responseSchema qui, ma puntiamo a un output testuale che contenga il JSON
            // come richiesto dalle istruzioni nel prompt.
            const response = await ai.models.generateContent({
                model: modelName,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                config: {
                    // Impostiamo un System Instruction più specifico per l'output JSON
                    systemInstruction: "Sei un analista AI. La tua unica uscita deve essere un oggetto JSON valido, come richiesto nel prompt, senza testo aggiuntivo o preamboli.",
                    temperature: 0.2, // Una bassa temperatura per output strutturati
                }
            });

            // Restituisce il testo grezzo (che dovrebbe contenere il JSON)
            return response.text; 

        } catch (error) {
            lastError = error;

            // Logica di Exponential Backoff
            // Controlla se l'errore è un 503 Service Unavailable (che indica sovraccarico)
            if (error.status === 503) {
                const waitTime = Math.pow(2, attempt) * 1000 + (Math.random() * 1000); // 1s, 2s, 4s, 8s, ... + jitter
                console.warn(`[GeminiService] Tentativo ${attempt + 1}/${MAX_RETRIES} fallito (503 Service Unavailable). Riprovo in ${Math.round(waitTime / 1000)}s...`);
                
                if (attempt < MAX_RETRIES - 1) {
                    await delay(waitTime);
                    continue; // Riprova il ciclo
                }
            }
            
            // Se l'errore non è un 503, o se abbiamo esaurito i tentativi, logga e lancia
            console.error("[GeminiService] ERRORE definitivo durante la generazione dell'analisi:", lastError.message);
            throw new Error(`Failed to generate content from AI service: ${lastError.message}`);
        }
    }
    
    // Se usciamo dal ciclo senza successo dopo tutti i tentativi
    throw new Error(`Failed to generate content from AI service after ${MAX_RETRIES} attempts. Last error: ${lastError ? lastError.message : 'Unknown Error'}`);
}

module.exports = {
    generateAnalysis,
};
 