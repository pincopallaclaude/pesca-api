// /lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';
import * as logger from '#lib/utils/logger.js';
import { generateWithMistral } from '#lib/services/mistral.service.js';
import { generateWithClaude } from '#lib/services/claude.service.js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- MODELLI STABILI ---
const TEXT_MODEL_NAME = "gemini-pro";
const EMBEDDING_MODEL_NAME = "text-embedding-004";

const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL_NAME });

async function generateWithBestModel(request) {
    let lastError = null;

    // --- 1. TENTATIVO CON GEMINI (MODELLO STABILE) ---
    try {
        logger.log(`[Multi-Model] Tentativo Gemini (gemini-pro)...`);
        const model = genAI.getGenerativeModel({ 
            model: TEXT_MODEL_NAME,
            // RIMOSSI safetySettings per massima compatibilità
        });
        const result = await model.generateContent(request);
        logger.log(`[Multi-Model] ✅ Successo con Gemini.`);
        return { response: result.response, provider: 'google' };
    } catch (error) {
        lastError = error;
        logger.error(`[Multi-Model] ❌ Errore con Gemini: ${error.message}`);
    }

    // --- 2. FALLBACK SU MISTRAL ---
    logger.warn(`[Multi-Model] Fallback su Mistral...`);
    try {
        const mistralResponse = await generateWithMistral(request);
        logger.log(`[Multi-Model] ✅ Successo con Mistral.`);
        return { response: mistralResponse, provider: 'mistral' };
    } catch (mistralError) {
        logger.error(`[Multi-Model] ❌ Fallback su Mistral fallito: ${mistralError.message}`);
        lastError = mistralError;
    }

    // --- 3. FALLBACK FINALE SU CLAUDE ---
    logger.warn(`[Multi-Model] Fallback finale su Claude...`);
    try {
        const claudeResponse = await generateWithClaude(request);
        logger.log(`[Multi-Model] ✅ Successo con Claude.`);
        return { response: claudeResponse, provider: 'anthropic' };
    } catch (claudeError) {
        logger.error(`[Multi-Model] ❌ Fallback su Claude fallito: ${claudeError.message}`);
        throw lastError || claudeError;
    }
}

export async function generateAnalysis(prompt) {
    const request = { contents: [{ role: 'user', parts: [{ text: prompt }] }] };
    const { response } = await generateWithBestModel(request);
    return response.text();
}

export async function generateWithTools(agentRequest) {
    const { response, provider } = await generateWithBestModel(agentRequest);
    logger.log(`[Agent] Risposta ricevuta dal provider: ${provider}`);
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