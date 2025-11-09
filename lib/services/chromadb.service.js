// lib/services/chromadb.service.js

import axios from 'axios';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1'; // Endpoint API di ChromaDB
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

// La variabile non conterrà più l'oggetto SDK, ma un flag o i metadati dopo l'inizializzazione.
let _collection = null; 
let _isInitializing = false;
let _initializationPromise = null;

const GeminiEmbeddingFunction = {
    // Nota: Le funzioni di embedding qui continuano a generare i vettori (non più gestite internamente da Chroma)
    embedDocuments: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY'),
};

/**
 * Inizializza la connessione al server ChromaDB e assicura che la collection esista.
 */
async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🏠 Connessione al server ChromaDB locale via HTTP...`);
        
        // 1. Controlla se la collection esiste già
        try {
            logger.log(`[ChromaDB] Verifico esistenza collection '${COLLECTION_NAME}'...`);
            // Tentativo di GET della collection
            await axios.get(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}`);
            logger.log(`[ChromaDB] ✅ Collection già esistente.`);
        } catch (error) {
            // Se riceviamo un 404, significa che la collection non esiste e dobbiamo crearla.
            if (error.response && error.response.status === 404) {
                logger.warn(`[ChromaDB] ⚠️ Collection non trovata. Procedo con la creazione...`);
                await axios.post(`${CHROMA_API_URL}/collections`, {
                    name: COLLECTION_NAME,
                    // Non passiamo l'embedding function, gli embeddings vengono passati in addDocuments
                });
                logger.log(`[ChromaDB] ✅ Collection '${COLLECTION_NAME}' creata con successo.`);
            } else {
                // Se l'errore è diverso da 404, è un problema reale (e.g. connessione fallita, server non risponde)
                throw error;
            }
        }
        
        // 2. Recupera il conteggio finale e imposta lo stato come pronto.
        const countResponse = await axios.get(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/count`);
        const count = countResponse.data.count;
        
        _collection = { name: COLLECTION_NAME, count: count }; 
        
        logger.log(`[ChromaDB] ✅ Collection pronta con ${count} documenti. Inizializzazione completata.`);

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
    // Restituisce l'oggetto stub (contiene almeno il nome)
    return _collection; 
}

export const initializeChromaDB = getCollection;

/**
 * Esegue una query RAG sulla knowledge base.
 */
export async function queryKnowledgeBase(queryText, options = {}) {
    // Attendiamo l'inizializzazione
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
            // Conversione del formato filtro per l'API Chroma (funziona come nell'SDK)
            whereClause['$and'] = filterEntries.map(([key, value]) => ({ [key]: { '$in': Array.isArray(value) ? value : [value] } }));
        }
    }
    
    // Calcolo degli embedding tramite il servizio Gemini
    const queryEmbedding = await GeminiEmbeddingFunction.embedQuery([queryText]);

    // Costruzione del corpo della richiesta per l'API HTTP
    const requestBody = {
        query_embeddings: queryEmbedding, // Nota: snake_case per l'API HTTP
        n_results: initialDocsToFetch,
        include: ['documents', 'metadatas', 'distances']
    };

    if (Object.keys(whereClause).length > 0) {
        requestBody.where = whereClause;
    }

    // Esecuzione della query tramite chiamata POST diretta
    const response = await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/query`, requestBody);
    const results = response.data;

    // Parsing e formattazione dei risultati (la struttura della risposta è la stessa dell'SDK)
    if (!results || !results.documents || !results.documents[0] || results.documents[0].length === 0) {
        logger.warn('[ChromaDB] ⚠️ Nessun documento trovato.');
        return [];
    }
    
    const formattedResults = results.documents[0].map((doc, index) => ({
        content: doc,
        metadata: results.metadatas[0][index],
        // La similarità è 1 - distanza nel modello Chroma (la API restituisce la distanza)
        similarity: 1 - results.distances[0][index]
    }));
    
    logger.log(`[ChromaDB] ✅ Recuperati ${formattedResults.length} risultati.`);

    if (useReranking && formattedResults.length > 0) {
        const { rerankDocuments } = await import('./reranker.service.js');
        // Reranker riceve i risultati formattati e la query, e restituisce i topK riordinati
        return await rerankDocuments(queryText, formattedResults, topK);
    }
    
    return formattedResults.slice(0, topK);
}

/**
 * Aggiunge documenti (chunk) alla collection.
 */
export async function addDocuments(documents) {
    if (documents.length === 0) return;
    await getCollection(); // Assicura l'inizializzazione

    // Calcolo degli embedding per i documenti prima dell'invio (necessario perché non usiamo l'EmbeddingFunction di Chroma)
    const embeddings = await GeminiEmbeddingFunction.embedDocuments(documents.map(d => d.content));

    // Chiamata POST diretta per aggiungere documenti
    await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/add`, {
        ids: documents.map(d => d.id),
        embeddings: embeddings, // Includi gli embeddings pre-calcolati
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
        // Tentativo di eliminazione tramite chiamata DELETE diretta
        const response = await axios.delete(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}`);
        
        // Gestione del caso di successo (200/204)
        if (response.status === 200 || response.status === 204) {
             logger.log(`[ChromaDB] 🗑️ Collection "${COLLECTION_NAME}" resettata. Verrà ricreata al prossimo accesso.`);
        }
    } catch (e) {
        // Gestione dell'errore 404 (Collection non trovata)
        if (e.response && e.response.status === 404) {
            logger.log(`[ChromaDB] ⚠️ Tentativo di reset fallito: Collection "${COLLECTION_NAME}" non esistente (OK).`);
        } else {
             logger.error(`[ChromaDB] ❌ Errore durante il reset: ${e.message}`);
             // Re-throw se si tratta di un errore critico di connessione
             throw e;
        }
    }
    // Forza il reset dello stato interno
    _collection = null; 
}