// lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '../utils/logger.js'; // Importa tutto come 'logger'

// Inizializzazione del client con la chiave API da .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Modello stabile per la generazione di analisi
const MODEL_NAME = "gemini-2.5-flash"; // Aggiornato a un modello più recente
// Modello specifico per gli embedding, stato dell'arte per RAG
const EMBEDDING_MODEL_NAME = "text-embedding-004"; 

// Otteniamo il modello di embedding una sola volta all'avvio per efficienza
const embeddingModel = genAI.getGenerativeModel({ 
    model: EMBEDDING_MODEL_NAME 
});

/**
 * Funzione di utilità per ritardare l'esecuzione.
 * @param {number} ms - Millisecondi da attendere.
 * @returns {Promise<void>}
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Genera un'analisi utilizzando il modello Gemini con logica di retry.
 * @param {string} prompt - Il prompt completo da inviare al modello.
 * @returns {Promise<string>} La risposta testuale del modello.
 */
async function generateAnalysis(prompt) {
    const MAX_RETRIES = 3; // Ridotto a 3 per una risposta più rapida in caso di fallimento
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ model: MODEL_NAME });
            // Le istruzioni di sistema sono gestite meglio a livello di configurazione del modello se disponibili
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            lastError = error;
            const isRetryable = error.message?.includes('503') || error.message?.toLowerCase().includes('network');

            if (isRetryable && attempt < MAX_RETRIES - 1) {
                const waitTime = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                logger.warn(`[GeminiService] Tentativo ${attempt + 1}/${MAX_RETRIES} fallito. Riprovo in ${Math.round(waitTime / 1000)}s...`);
                await delay(waitTime);
            } else {
                logger.error(`[GeminiService] ❌ ERRORE non ritentabile durante la generazione: ${error.message}`);
                throw new Error(`Failed to generate content from AI service: ${error.message}`);
            }
        }
    }
    
    throw new Error(`Failed to generate content after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || 'Unknown Error'}`);
}

/**
 * Genera embeddings per un array di testi in un unico batch.
 * @param {string[]} texts L'array di testi da vettorizzare.
 * @param {'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'} taskType Il tipo di task per ottimizzare l'embedding.
 * @returns {Promise<number[][]>} Un array di vettori (embeddings).
 */
  async function getGeminiEmbeddings(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  try {
    // Controlla che il content non sia una stringa vuota, che causa un errore 400
    const validTexts = texts.filter(text => text && text.trim() !== '');
    if (validTexts.length === 0) {
      logger.warn('[Gemini Embed] Tutti i testi forniti erano vuoti. Restituisco un array vuoto.');
      return [];
    }
    
    const result = await embeddingModel.batchEmbedContents({
      requests: validTexts.map(text => ({
        content: { parts: [{ text }] }, // API Recente richiede questo formato esplicito
        taskType: taskType
      }))
    });
    return result.embeddings.map(e => e.values);
  } catch (error) {
    logger.error(`[Gemini Embed] ❌ Errore API durante la vettorizzazione batch: ${error.message}`);
    const detailedError = error.cause || error.details || error.message;
    logger.error(`[Gemini Embed] Dettagli: ${JSON.stringify(detailedError)}`);
    throw new Error('Failed to generate embeddings from Gemini API.');
  }
}

export { 
    generateAnalysis,
    getGeminiEmbeddings // <-- Esportiamo la nuova funzione batch, che sostituisce quella singola.
};