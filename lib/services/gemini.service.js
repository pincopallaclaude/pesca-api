// /lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '../utils/logger.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- MODELLI ---
const TEXT_MODEL_NAME = "gemini-1.5-flash"; // Usa il modello che preferisci
const EMBEDDING_MODEL_NAME = "text-embedding-004";

// Istanza riutilizzabile del modello di embedding
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

/**
 * Funzione interna che gestisce la logica di chiamata e retry a Gemini.
 */
async function generateWithGemini(request) {
    const MAX_RETRIES = 3;
    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const model = genAI.getGenerativeModel({ model: TEXT_MODEL_NAME });
            const result = await model.generateContent(request);
            return result.response;
        } catch (error) {
            lastError = error;
            const isRetryable = error.message?.includes('503') || error.message?.includes('429') || error.message?.toLowerCase().includes('network');

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
 * Genera un'analisi testuale semplice (per retrocompatibilità).
 * @param {string} prompt - Il prompt.
 * @returns {Promise<string>} La risposta testuale.
 */
export async function generateAnalysis(prompt) {
    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    const response = await generateWithGemini(request);
    return response.text();
}

/**
 * Esegue una chiamata a Gemini con supporto per il tool calling (per l'agente).
 * @param {object} agentRequest - L'oggetto richiesta per l'agente (contents, tools, etc.).
 * @returns {Promise<object>} La risposta completa (candidate) dal modello.
 */
export async function generateWithTools(agentRequest) {
    const response = await generateWithGemini(agentRequest);
    return response.candidates[0]; 
}

/**
 * Genera embeddings per un array di testi.
 * @param {string[]} texts - I testi da vettorizzare.
 * @param {'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'} taskType - Il tipo di task.
 * @returns {Promise<number[][]>} Un array di vettori.
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