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
        
        // --- NUOVA LOGICA: USA list_collections PER EVITARE ECCEZIONI ---
        logger.log(`[ChromaDB] Verifico esistenza collection '${COLLECTION_NAME}'...`);
        // 1. Chiamata GET all'endpoint /collections per listare tutte le collezioni
        const response = await axios.get(`${CHROMA_API_URL}/collections`);
        const collections = response.data; // Questo è un array di oggetti collection

        // 2. Filtra per nome
        const collectionExists = collections.some(collection => collection.name === COLLECTION_NAME);

        if (collectionExists) {
            logger.log(`[ChromaDB] ✅ Collection già esistente.`);
        } else {
            logger.warn(`[ChromaDB] ⚠️ Collection non trovata. Procedo con la creazione...`);
            // 3. Crea la collection se non esiste
            await axios.post(`${CHROMA_API_URL}/collections`, {
                name: COLLECTION_NAME,
            });
            logger.log(`[ChromaDB] ✅ Collection '${COLLECTION_NAME}' creata con successo.`);
        }
        
        // Impostiamo lo stato come pronto. Il contenuto dettagliato della collection non è necessario
        // per lo stato di "servizio pronto".
        _collection = { name: COLLECTION_NAME, count: 'unknown' };
        logger.log(`[ChromaDB] ✅ Inizializzazione completata. Collection '${COLLECTION_NAME}' è pronta.`);
        // --- FINE NUOVA LOGICA ---

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

    // --- INIZIO MODIFICA: La clausola WHERE va costruita diversamente per l'API REST ---
    let whereClause = {}; 
    if (filters) {
        // L'API REST accetta l'oggetto filtri direttamente.
        whereClause = filters;
    }
    // --- FINE MODIFICA ---
    
    const queryEmbedding = await GeminiEmbeddingFunction.embedQuery([queryText]);

    const requestBody = {
        query_embeddings: queryEmbedding,
        n_results: initialDocsToFetch,
        include: ['documents', 'metadatas', 'distances']
    };

    if (Object.keys(whereClause).length > 0) {
        requestBody.where = whereClause;
    }

    try {
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

    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore durante la query: ${error.message}`);
        // Logga i dettagli dell'errore per il debug
        if (error.response) {
            console.error('Dettagli errore Axios:', error.response.data);
        }
        return []; // Ritorna un array vuoto in caso di errore
    }
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