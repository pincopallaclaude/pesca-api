// lib/services/chromadb.service.js

import { ChromaClient } from 'chromadb'; 
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';
const CHROMA_URL = process.env.CHROMA_DB_URL || 'http://localhost:8001';

/**
 * Oggetto che funge da "Embedding Function" per ChromaDB.
 * Rispetta l'interfaccia richiesta implementando un metodo 'generate'.
 * Questo approccio è più robusto ai cambiamenti della libreria rispetto all'ereditarietà.
 */
const GeminiEmbeddingFunction = {
  /**
   * @param {string[]} texts
   */
  embedDocuments: async function(texts) {
    logger.log(`[ChromaEmbed] Vettorizzo ${texts.length} documenti...`);
    // Usiamo il taskType corretto per i documenti
    return await getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT');
  },

  /**
   * @param {string[]} texts
   */
  embedQuery: async function(texts) {
    logger.log(`[ChromaEmbed] Vettorizzo ${texts.length} query...`);
    // Usiamo il taskType corretto per le query
    return await getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY');
  }
};

// Inizializzazione dei componenti di ChromaDB
const client = new ChromaClient({
    // path è deprecato per la connessione a un server, usiamo host/port
    host: 'localhost',
    port: '8001',
    ssl: false
});
// Usa il nostro OGGETTO come funzione di embedding.
const embedder = GeminiEmbeddingFunction; 
let collection = null;

// --- NESSUN'ALTRA MODIFICA NECESSARIA AL RESTO DEL FILE ---
// (Il resto del file da 'initializeChromaDB' in poi è corretto e rimane invariato)

async function initializeChromaDB() {
    try {
        logger.log(`[ChromaDB] 🔌 Connessione a ChromaDB (${CHROMA_URL})...`);
        await client.heartbeat();
        logger.log(`[ChromaDB] ✅ Server alive.`);
        
        collection = await client.getOrCreateCollection({ 
            name: COLLECTION_NAME, 
            embeddingFunction: embedder 
        });
        
        const count = await collection.count();
        logger.log(`[ChromaDB] ✅ Collection "${COLLECTION_NAME}" caricata (${count} documenti).`);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        throw error;
    }
}

async function queryKnowledgeBase(queryText, options = {}) {
    const { 
        topK = 5, 
        filters = null,
        useReranking = false,
        rerankTopK = 10,
    } = options;

    if (!collection) {
        logger.error('[ChromaDB] ❌ Tentativo di query su collection non inizializzata.');
        throw new Error('ChromaDB collection not initialized.');
    }

    const initialDocsToFetch = useReranking ? Math.max(rerankTopK, topK) : topK;
    logger.log(`[ChromaDB] 🔍 Query: "${queryText.substring(0, 50)}...". Fetch iniziale: ${initialDocsToFetch}.`);
    
    let whereClause = {};
    if (filters) {
        const filterEntries = Object.entries(filters);
        if (filterEntries.length > 0) {
          whereClause['$and'] = filterEntries.map(([key, value]) => ({ [key]: { '$in': Array.isArray(value) ? value : [value] } }));
        }
    }

    const queryEmbedding = await embedder.embedQuery([queryText]);

    const results = await collection.query({
        queryEmbeddings: queryEmbedding, // Passiamo il vettore pre-calcolato
        nResults: initialDocsToFetch,
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
        include: ['documents', 'metadatas', 'distances']
    });

    if (!results || !results.documents || results.documents[0].length === 0) {
        logger.warn('[ChromaDB] ⚠️ Nessun documento trovato per la query.');
        return [];
    }

    const formattedResults = results.documents[0].map((doc, index) => ({
        content: doc,
        metadata: results.metadatas[0][index],
        similarity: 1 - results.distances[0][index]
    }));
    
    logger.log(`[ChromaDB] ✅ Recuperati ${formattedResults.length} risultati iniziali.`);

    if (useReranking && formattedResults.length > 0) {
        logger.log('[ChromaDB] 🚀 Attivazione re-ranking...');
        const { rerankDocuments } = await import('./reranker.service.js');
        const reranked = await rerankDocuments(queryText, formattedResults, topK);
        logger.log(`[ChromaDB] 🎯 Processo completato. Restituisco ${reranked.length} documenti post-reranking.`);
        return reranked;
    }

    return formattedResults.slice(0, topK);
}

async function addDocuments(documents) {
  if (!collection) throw new Error('ChromaDB non inizializzato');
  if (documents.length === 0) return;
  
  await collection.add({
      ids: documents.map(d => d.id),
      documents: documents.map(d => d.content),
      metadatas: documents.map(d => d.metadata || {}),
  });
  logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti.`);
}

async function resetCollection() {
    if (!client) {
        logger.warn('[ChromaDB] ⚠️ Tentativo di reset con client non inizializzato.');
        return;
    }
    logger.log(`[ChromaDB] 🧹 Resetting collection "${COLLECTION_NAME}"...`);
    await client.deleteCollection({ name: COLLECTION_NAME });
    collection = await client.getOrCreateCollection({ name: COLLECTION_NAME, embeddingFunction: embedder });
    logger.log(`[ChromaDB] ✅ Collection "${COLLE_NAME}" ricreata.`);
}

export {
    initializeChromaDB,
    queryKnowledgeBase,
    addDocuments,
    resetCollection
};