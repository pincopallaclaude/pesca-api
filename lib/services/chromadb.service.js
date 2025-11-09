// lib/services/chromadb.service.js

import axios from 'axios';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1'; // Endpoint API di ChromaDB
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

let _collection = null; 
let _isInitializing = false;
let _initializationPromise = null;

const GeminiEmbeddingFunction = {
    embedDocuments: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY'),
};

/**
 * Inizializza la connessione al server ChromaDB e assicura che la collection esista.
 */
async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🏠 Connessione al server ChromaDB locale via HTTP...`);
        
        try {
            logger.log(`[ChromaDB] Verifico esistenza collection '${COLLECTION_NAME}'...`);
            await axios.get(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}`);
            logger.log(`[ChromaDB] ✅ Collection già esistente.`);
        } catch (error) {
            const isNotFoundError = (error.response && error.response.status === 404) || 
                                    (error.response?.data?.error?.includes("does not exist"));

            if (isNotFoundError) {
                logger.warn(`[ChromaDB] ⚠️ Collection non trovata. Procedo con la creazione...`);
                await axios.post(`${CHROMA_API_URL}/collections`, {
                    name: COLLECTION_NAME,
                });
                logger.log(`[ChromaDB] ✅ Collection '${COLLECTION_NAME}' creata con successo.`);
            } else {
                logger.error(`[ChromaDB] Errore imprevisto durante il GET della collection: ${error.message}`);
                throw error;
            }
        }
        
        // --- INIZIO MODIFICA ---
        // Rimuoviamo la chiamata a /count che causa l'errore.
        // Impostiamo uno stato "pronto" fittizio. Il conteggio reale non è necessario per l'avvio.
        _collection = { name: COLLECTION_NAME, count: 'unknown' }; // Stato fittizio
        logger.log(`[ChromaDB] ✅ Inizializzazione completata. Collection '${COLLECTION_NAME}' è pronta.`);
        // --- FINE MODIFICA ---

    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        console.error(error);
        _collection = null;
        throw error;
    }
}

/**
 * Funzione thread-safe per recuperare l'oggetto collection (garantisce l'inizializzazione).
 */
async function getCollection() {
    if (_collection) return _collection;

    if (!_isInitializing) {
        _isInitializing = true;
        logger.log('[ChromaDB] ⚡ Avvio inizializzazione lazy (Thread Safe).');
        _initializationPromise = _initialize().finally(() => {
            _isInitializing = false;
        });
    } else {
        logger.log('[ChromaDB] ⏱️ Inizializzazione già in corso, attendo Promise.');
    }

    await _initializationPromise;
    
    if (!_collection) {
        throw new Error('Inizializzazione di ChromaDB fallita.');
    }
    return _collection; 
}

export const initializeChromaDB = getCollection;

/**
 * Esegue una query RAG sulla knowledge base.
 */
export async function queryKnowledgeBase(queryText, options = {}) {
    await getCollection();
    
    const { 
        topK = 5, 
        filters = null,
        useReranking = false,
        rerankTopK = 10,
    } = options;
    
    logger.log(`[ChromaDB] 🔍 Query: "${queryText.substring(0, 50)}...". Opzioni: ${JSON.stringify(options)}`);
    const initialDocsToFetch = useReranking ? Math.max(rerankTopK, topK) : topK;

    let whereClause = {};
    if (filters) {
        const filterEntries = Object.entries(filters);
        if (filterEntries.length > 0) {
            whereClause['$and'] = filterEntries.map(([key, value]) => ({ [key]: { '$in': Array.isArray(value) ? value : [value] } }));
        }
    }
    
    const queryEmbedding = await GeminiEmbeddingFunction.embedQuery([queryText]);

    const requestBody = {
        query_embeddings: queryEmbedding,
        n_results: initialDocsToFetch,
        include: ['documents', 'metadatas', 'distances']
    };

    if (Object.keys(whereClause).length > 0) {
        requestBody.where = whereClause;
    }

    const response = await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/query`, requestBody);
    const results = response.data;

    if (!results || !results.documents || !results.documents[0] || results.documents[0].length === 0) {
        logger.warn('[ChromaDB] ⚠️ Nessun documento trovato.');
        return [];
    }
    
    const formattedResults = results.documents[0].map((doc, index) => ({
        content: doc,
        metadata: results.metadatas[0][index],
        similarity: 1 - results.distances[0][index]
    }));
    
    logger.log(`[ChromaDB] ✅ Recuperati ${formattedResults.length} risultati.`);

    if (useReranking && formattedResults.length > 0) {
        const { rerankDocuments } = await import('./reranker.service.js');
        return await rerankDocuments(queryText, formattedResults, topK);
    }
    
    return formattedResults.slice(0, topK);
}

/**
 * Aggiunge documenti (chunk) alla collection.
 */
export async function addDocuments(documents) {
    if (documents.length === 0) return;
    await getCollection();

    const embeddings = await GeminiEmbeddingFunction.embedDocuments(documents.map(d => d.content));

    await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/add`, {
        ids: documents.map(d => d.id),
        embeddings: embeddings,
        documents: documents.map(d => d.content),
        metadatas: documents.map(d => d.metadata || {}),
    });
    logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti.`);
}

/**
 * Elimina la collection (riabilitato per l'ambiente locale).
 */
export async function resetCollection() {
    logger.log(`[ChromaDB] ⏳ Tentativo di reset della Collection "${COLLECTION_NAME}"...`);
    
    try {
        const response = await axios.delete(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}`);
        
        if (response.status === 200 || response.status === 204) {
             logger.log(`[ChromaDB] 🗑️ Collection "${COLLECTION_NAME}" resettata. Verrà ricreata al prossimo accesso.`);
        }
    } catch (e) {
        if (e.response && e.response.status === 404) {
            logger.log(`[ChromaDB] ⚠️ Tentativo di reset fallito: Collection "${COLLECTION_NAME}" non esistente (OK).`);
        } else {
             logger.error(`[ChromaDB] ❌ Errore durante il reset: ${e.message}`);
             throw e;
        }
    }
    _collection = null; 
}