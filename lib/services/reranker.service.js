// lib/services/reranker.service.js

import { HfInference } from '@huggingface/inference';
import * as logger from '../utils/logger.js';
import 'dotenv/config';

// Inizializza il client una sola volta
const hf = new HfInference(process.env.HF_TOKEN);
const RERANKER_MODEL = "BAAI/bge-reranker-large";

/**
 * Riordina una lista di documenti in base alla loro pertinenza con una query,
 * utilizzando un modello cross-encoder da Hugging Face.
 * @param {string} query La query dell'utente.
 * @param {Array<{content: string, metadata: object, similarity: number}>} documents I documenti recuperati da ChromaDB.
 * @param {number} topK Il numero di documenti finali da restituire.
 * @returns {Promise<Array<{content: string, metadata: object, similarity: number}>>} I documenti riordinati.
 */
export async function rerankDocuments(query, documents, topK = 5) {
    if (!documents || documents.length === 0) {
        return [];
    }

    logger.log(`[Reranker] ▶️ Avvio re-ranking per ${documents.length} documenti con modello: ${RERANKER_MODEL}`);

    try {
        const documentContents = documents.map(doc => doc.content);

        // --- CORREZIONE: Il nome corretto della funzione è 'sentenceSimilarity' ---
        const scores = await hf.sentenceSimilarity({
            model: RERANKER_MODEL,
            inputs: {
                source_sentence: query,
                sentences: documentContents
            }
        });

        // Combina i documenti con i loro nuovi punteggi
        const rankedDocs = documents.map((doc, i) => ({
            ...doc,
            rerank_score: scores[i]
        })).sort((a, b) => b.rerank_score - a.rerank_score); // Ordina dal più alto al più basso

        logger.log(`[Reranker] ✅ Re-ranking completato. Punteggio più alto: ${rankedDocs[0]?.rerank_score.toFixed(4)}`);
        
        return rankedDocs.slice(0, topK);

    } catch (error) {
        logger.error(`[Reranker] ❌ Errore durante il re-ranking: ${error.message}`);
        logger.warn(`[Reranker] ⚠️ Fallback: restituisco i documenti nell'ordine originale di ChromaDB.`);
        // --- CORREZIONE: La logica di fallback deve restituire i documenti originali ---
        return documents.slice(0, topK); 
    }
}