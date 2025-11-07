// lib/services/reranker.service.js

import { HfInference } from '@huggingface/inference';
import 'dotenv/config';
import * as logger from '../utils/logger.js';

// Inizializza il client generico
const hf = new HfInference(process.env.HF_TOKEN);
const RERANK_MODEL = 'BAAI/bge-reranker-large';

/**
 * Riordina una lista di documenti in base alla loro pertinenza con una query.
 *
 * @param {string} query La query di ricerca.
 * @param {Array<object>} documents Array di oggetti documento da ChromaDB.
 * @param {number} topK Il numero finale di documenti da restituire.
 * @returns {Promise<Array<object>>} Un array di documenti riordinati.
 */
export async function rerankDocuments(query, documents, topK = 5) {
  if (!documents || documents.length === 0) {
    return [];
  }

  logger.log(`[Reranker] ▶️ Avvio re-ranking per ${documents.length} documenti con modello: ${RERANK_MODEL}`);
  
  try {
    // Estrae il contenuto testuale di ogni documento.
    const texts = documents.map(doc => doc.content);

    // Usa il metodo 'sentenceSimilarity', che è l'endpoint corretto
    // per calcolare la pertinenza tra una frase sorgente (la query)
    // e una lista di altre frasi (i documenti).
    const scores = await hf.sentenceSimilarity({
      model: RERANK_MODEL,
      inputs: {
        source_sentence: query,
        sentences: texts
      }
    });

    // Aggiungi i punteggi ai documenti originali.
    const scoredDocuments = documents.map((doc, index) => ({
      ...doc,
      rerankScore: scores[index] 
    }));

    // Ordina i documenti in base al nuovo punteggio, in ordine decrescente.
    scoredDocuments.sort((a, b) => b.rerankScore - a.rerankScore);

    logger.log(`[Reranker] ✅ Re-ranking completato. Punteggio più alto: ${scoredDocuments[0]?.rerankScore?.toFixed(4)}`);

    return scoredDocuments.slice(0, topK);

  } catch (error) {
    logger.error(`[Reranker] ❌ Errore durante il re-ranking: ${error.message}`);
    logger.warn('[Reranker] ⚠️ Fallback: restituisco i documenti nell\'ordine originale di ChromaDB.');
    return documents.slice(0, topK);
  }
}