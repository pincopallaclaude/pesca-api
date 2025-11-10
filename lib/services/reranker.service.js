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
    
    // --- NUOVO LOG DI DEBUG (INPUT) ---
    console.log("--- DEBUG RE-RANKER (INPUT) ---");
    console.log(`Query: ${query.substring(0, 50)}...`);
    console.log(`Numero documenti in input: ${documents.length}`);
    console.log("--- FINE DEBUG (INPUT) ---");

    try {
        // Estrae il contenuto testuale di ogni documento.
        const texts = documents.map(doc => doc.content);

        // **CORREZIONE**: Uso dell'endpoint 'rerank' al posto di 'sentenceSimilarity'
        const response = await hf.rerank({
            model: RERANK_MODEL,
            inputs: {
                query: query,
                texts: texts
            },
            // Il reranker di Hugging Face può accettare 'top_n'
            // Ma gestiamo il slicing dopo per coerenza con il codice originale
        });

        // La risposta di hf.rerank è un array di oggetti { index: number, score: number }
        const rerankedResults = response.results;

        // Combina i punteggi con i documenti originali.
        const scoredDocuments = rerankedResults.map(result => ({
            ...documents[result.index], // Recupera il documento originale
            rerankScore: result.score 
        }));
        
        // I risultati sono già ordinati dal modello, ma riordiniamo per sicurezza e prendiamo i top K
        scoredDocuments.sort((a, b) => b.rerankScore - a.rerankScore);

        logger.log(`[Reranker] ✅ Re-ranking completato. Punteggio più alto: ${scoredDocuments[0]?.rerankScore?.toFixed(4)}`);

        // --- NUOVO LOG DI DEBUG (OUTPUT) ---
        console.log("--- DEBUG RE-RANKER (OUTPUT) ---");
        console.log(`Numero documenti dopo re-ranking: ${scoredDocuments.length}`);
        console.log("Primi 2 documenti riordinati (struttura):");
        console.log(JSON.stringify(scoredDocuments.slice(0, 2), null, 2));
        console.log("--- FINE DEBUG (OUTPUT) ---");
        // --- FINE LOG ---

        return scoredDocuments.slice(0, topK);

    } catch (error) {
        logger.error(`[Reranker] ❌ Errore durante il re-ranking: ${error.message}`);
        logger.warn('[Reranker] ⚠️ Fallback: restituisco i documenti nell\'ordine originale di ChromaDB.');
        return documents.slice(0, topK);
    }
}