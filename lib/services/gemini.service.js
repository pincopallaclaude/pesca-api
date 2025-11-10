// lib/services/gemini.service.js
import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '../utils/logger.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// --- CORREZIONE: Torniamo al modello stabile 1.5 ---
const MODEL_NAME = "gemini-2.5-flash"; 
const EMBEDDING_MODEL_NAME = "text-embedding-004"; 

const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Genera un'analisi utilizzando il modello Gemini con logica di retry.
 * @param {string} prompt - Il prompt completo da inviare al modello.
 * @returns {Promise<string>} La risposta testuale del modello.
 */
export async function generateAnalysis(prompt) {
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ model: MODEL_NAME });
            const result = await model.generateContent(prompt);
            const response = await result.response;
            return response.text();
        } catch (error) {
            lastError = error;
            // Aggiungiamo un controllo per i 429 (Rate Limit)
            const isRetryable = error.message?.includes('503') || error.message?.includes('429') || error.message?.toLowerCase().includes('network');

            if (isRetryable && attempt < MAX_RETRIES - 1) {
                const waitTime = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                logger.warn(`[GeminiService] Tentativo ${attempt + 1}/${MAX_RETRIES} fallito (${error.message}). Riprovo in ${Math.round(waitTime / 1000)}s...`);
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
 * Genera embeddings per un array di testi.
 * @param {string[]} texts L'array di testi da vettorizzare.
 * @param {'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'} taskType Il tipo di task.
 * @returns {Promise<number[][]>} Un array di vettori (embeddings).
 */
export async function getGeminiEmbeddings(texts, taskType = 'RETRIEVAL_DOCUMENT') {
  try {
    const validTexts = texts.filter(text => text && text.trim() !== '');
    if (validTexts.length === 0) return [];
    
    const result = await embeddingModel.batchEmbedContents({
      requests: validTexts.map(text => ({
        content: { parts: [{ text }] },
        taskType: taskType
      }))
    });
    return result.embeddings.map(e => e.values);
  } catch (error) {
    logger.error(`[Gemini Embed] ❌ Errore API durante la vettorizzazione: ${error.message}`);
    throw new Error('Failed to generate embeddings from Gemini API.');
  }
}