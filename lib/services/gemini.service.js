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
 * Funzione diagnostica per estrarre il codice HTTP dall'errore.
 */
function extractErrorCode(errorMessage) {
    const match = errorMessage.match(/\[(\d{3}) /);
    return match ? match[1] : 'N/A';
}

/**
 * [NUOVO E POTENZIATO] Orchestratore Multi-Modello.
 * Prova Gemini, poi fa fallback su Mistral e infine su Claude in caso di errori specifici.
 */
async function generateWithBestModel(request) {
    const MAX_RETRIES_GEMINI = 3; // Manteniamo 3 tentativi
    let lastError = null;
    const orchestrationStartTime = Date.now();
    let totalWaitTime = 0;

    // --- 1. TENTATIVO CON GEMINI (CON BACKOFF) ---
    for (let attempt = 0; attempt < MAX_RETRIES_GEMINI; attempt++) {
        const callStartTime = Date.now();
        
        try {
            logger.log(`[Gemini-CALL] 🔎 Tentativo ${attempt + 1}/${MAX_RETRIES_GEMINI}. Avvio chiamata...`);
            
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
            
            const callDuration = Date.now() - callStartTime;
            logger.log(`[Gemini-CALL] ✅ SUCCESS. Durata: ${callDuration}ms. Tentativi totali: ${attempt + 1}.`);
            
            return { response: result.response, provider: 'google' };
        } catch (error) {
            lastError = error;
            const callDuration = Date.now() - callStartTime;
            const errorCode = extractErrorCode(error.message);
            const isOverloaded = errorCode === '503' || errorCode === '429';

            logger.error(`[Gemini-CALL] ❌ FALLIMENTO. Codice: ${errorCode}. Durata chiamata: ${callDuration}ms. Messaggio: ${error.message.substring(0, 100)}...`);
            
            if (isOverloaded && attempt < MAX_RETRIES_GEMINI - 1) {
                // ERRORE 503/429: Riprova con backoff esponenziale
                const waitTime = Math.pow(2, attempt) * 1000;
                totalWaitTime += waitTime;
                
                logger.warn(`[Gemini-BACKOFF] ⏳ Riprovo in ${waitTime / 1000}s. Tempo totale atteso finora: ${totalWaitTime}ms.`);
                await delay(waitTime);
                // Continua il loop
            } else {
                // Fallimento non recuperabile o ultimo tentativo fallito
                const totalTime = Date.now() - orchestrationStartTime;
                logger.error(`[Multi-Model] 🛑 FALLIMENTO FINALE GEMINI. Total time: ${totalTime}ms. Inizio fallback.`);
                break; // Esce dal loop per passare al fallback
            }
        }
    }

    // --- 2. FALLBACK SU MISTRAL ---
    const mistralStartTime = Date.now();
    logger.warn(`[Multi-Model] 🔄 Attivazione Fallback su Mistral...`);
    try {
        const mistralResponse = await generateWithMistral(request);
        const mistralDuration = Date.now() - mistralStartTime;
        logger.log(`[Mistral-CALL] ✅ SUCCESS. Durata: ${mistralDuration}ms.`);
        
        return { response: mistralResponse, provider: 'mistral' };
    } catch (mistralError) {
        logger.error(`[Mistral-CALL] ❌ Fallback su Mistral fallito: ${mistralError.message}`);
        lastError = mistralError; // Aggiorna l'ultimo errore
    }

    // --- 3. FALLBACK FINALE SU CLAUDE (se disponibile) ---
    const claudeStartTime = Date.now();
    logger.warn(`[Multi-Model] 🔄 Attivazione Fallback finale su Claude...`);
    try {
        const claudeResponse = await generateWithClaude(request);
        const claudeDuration = Date.now() - claudeStartTime;
        logger.log(`[Claude-CALL] ✅ SUCCESS. Durata: ${claudeDuration}ms.`);
        
        return { response: claudeResponse, provider: 'anthropic' };
    } catch (claudeError) {
        logger.error(`[Claude-CALL] ❌ Fallback su Claude fallito: ${claudeError.message}`);
        
        const totalOrchestrationTime = Date.now() - orchestrationStartTime;
        logger.error(`[Multi-Model] 💣 TUTTI I MODELLI FALLITI. Tempo Totale: ${totalOrchestrationTime}ms.`);
        
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