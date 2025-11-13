// /lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '../utils/logger.js';
// --- NUOVI IMPORT PER FALLBACK ---
import { generateWithMistral } from './mistral.service.js';
import { generateWithClaude } from './claude.service.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- MODELLI ---
const TEXT_MODEL_NAME = "gemini-2.5-flash"; // La tua scelta
const EMBEDDING_MODEL_NAME = "text-embedding-004";

// Istanza riutilizzabile del modello di embedding
const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

/**
 * [NUOVO E POTENZIATO] Orchestratore Multi-Modello.
 * Prova Gemini, poi fa fallback su Mistral e infine su Claude in caso di errori specifici.
 */
async function generateWithBestModel(request) {
    const MAX_RETRIES_GEMINI = 2; // Riduciamo i retry per passare prima al fallback
    let lastError = null;

    // --- 1. TENTATIVO CON GEMINI ---
    for (let attempt = 0; attempt < MAX_RETRIES_GEMINI; attempt++) {
        try {
            logger.log(`[Multi-Model] Tentativo Gemini ${attempt + 1}/${MAX_RETRIES_GEMINI}...`);
            
            // IMPOSTAZIONI DI SICUREZZA PER DEBUG: ABBASSARE LA CENSURA
            const safetySettings = [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
            ];

            const model = genAI.getGenerativeModel({ 
                model: TEXT_MODEL_NAME,
                safetySettings: safetySettings
            });
            const result = await model.generateContent(request);
            logger.log(`[Multi-Model] ✅ Successo con Gemini.`);
            // Restituisce un oggetto standardizzato
            return { response: result.response, provider: 'google' };
        } catch (error) {
            lastError = error;
            const isOverloaded = error.message?.includes('503') || error.message?.includes('429');
            
            if (isOverloaded) {
                logger.warn(`[Multi-Model] ⚠️ Gemini è sovraccarico (${error.message}). Tento fallback.`);
                break; // Esce dal loop per passare subito al fallback
            }

            if (attempt < MAX_RETRIES_GEMINI - 1) {
                const waitTime = Math.pow(2, attempt) * 1000;
                logger.warn(`[Multi-Model] Errore con Gemini. Riprovo in ${waitTime / 1000}s...`);
                await delay(waitTime);
            } else {
                logger.error(`[Multi-Model] Errore non recuperabile con Gemini: ${error.message}`);
            }
        }
    }

    // --- 2. FALLBACK SU MISTRAL ---
    logger.warn(`[Multi-Model] Fallback su Mistral...`);
    try {
        const mistralResponse = await generateWithMistral(request);
        logger.log(`[Multi-Model] ✅ Successo con Mistral.`);
        // Simula la struttura della risposta di Gemini per compatibilità
        return { response: mistralResponse, provider: 'mistral' };
    } catch (mistralError) {
        logger.error(`[Multi-Model] ❌ Fallback su Mistral fallito: ${mistralError.message}`);
        lastError = mistralError; // Aggiorna l'ultimo errore
    }

    // --- 3. FALLBACK FINALE SU CLAUDE (se disponibile) ---
    logger.warn(`[Multi-Model] Fallback finale su Claude...`);
    try {
        const claudeResponse = await generateWithClaude(request);
        logger.log(`[Multi-Model] ✅ Successo con Claude.`);
        return { response: claudeResponse, provider: 'anthropic' };
    } catch (claudeError) {
        logger.error(`[Multi-Model] ❌ Fallback su Claude fallito: ${claudeError.message}`);
        // Se anche l'ultimo fallback fallisce, rilanciamo l'errore più recente
        throw lastError || claudeError;
    }
}

/**
 * Genera un'analisi testuale semplice. (Wrapper per retrocompatibilità)
 */
export async function generateAnalysis(prompt) {
    const request = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    };
    // Usa il nuovo orchestratore
    const { response } = await generateWithBestModel(request);
    return response.text();
}

/**
 * Esegue una chiamata AI con supporto per il tool calling. (Wrapper per l'agente)
 */
export async function generateWithTools(agentRequest) {
    // Usa il nuovo orchestratore
    const { response, provider } = await generateWithBestModel(agentRequest);
    logger.log(`[Agent] Risposta ricevuta dal provider: ${provider}`);
    // La struttura .candidates[0] è specifica di Gemini. 
    // I servizi di fallback devono simulare questa struttura.
    return response.candidates[0];
}

/**
 * Genera embeddings per un array di testi. (INVARIATO)
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