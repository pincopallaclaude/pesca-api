// lib/services/chromadb.service.js

import { ChromaClient, CloudClient } from 'chromadb';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

let _collection = null;
let _isInitializing = false;
let _initializationPromise = null;

const GeminiEmbeddingFunction = {
    embedDocuments: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY'),
};

async function _initialize() {
    try {
        let client;
        
        if (process.env.CHROMA_DB_HOST && process.env.CHROMA_API_KEY) {
            // --- CONNESSIONE CHROMA CLOUD ---
            logger.log(`[ChromaDB] ☁️ Rilevata configurazione Cloud. Connessione...`);
            // Usa CloudClient come da documentazione ufficiale per l'ambiente Cloud
            client = new CloudClient({
                apiKey: process.env.CHROMA_API_KEY,
                tenant: process.env.CHROMA_DB_HOST,
                database: 'pesca-api-db', // Nome del database su Chroma Cloud
            });
        } else {
            // --- CONNESSIONE LOCALE (per sviluppo con Docker) ---
            const host = '127.0.0.1';
            const port = '8001';
            
            logger.log(`[ChromaDB] 🏠 Configurazione locale. Connessione a: ${host}:${port}`);
            client = new ChromaClient({ 
                host: host, 
                port: port,
                ssl: false
            });
        }
        
        // La chiamata getOrCreateCollection crea la collection se non esiste e la recupera altrimenti
        _collection = await client.getOrCreateCollection({ 
            name: COLLECTION_NAME, 
            embeddingFunction: GeminiEmbeddingFunction 
        });
        
        const count = await _collection.count();
        logger.log(`[ChromaDB] ✅ Collection "${COLLECTION_NAME}" pronta con ${count} documenti.`);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        // Rilancia l'errore per segnalare il fallimento dell'inizializzazione
        throw error;
    }
}

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
        // Messaggio d'errore più conciso per il rilancio
        throw new Error('Inizializzazione di ChromaDB fallita.');
    }
    return _collection;
}

export const initializeChromaDB = getCollection;

export async function queryKnowledgeBase(queryText, options = {}) {
    const collection = await getCollection();
    
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

    const results = await collection.query({
        queryEmbeddings: queryEmbedding,
        nResults: initialDocsToFetch,
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined,
        include: ['documents', 'metadatas', 'distances']
    });

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
        // Reranker riceve i risultati formattati e la query, e restituisce i topK riordinati
        return await rerankDocuments(queryText, formattedResults, topK);
    }
    
    return formattedResults.slice(0, topK);
}

export async function addDocuments(documents) {
    if (documents.length === 0) return;
    const collection = await getCollection();
    await collection.add({
        ids: documents.map(d => d.id),
        documents: documents.map(d => d.content),
        metadatas: documents.map(d => d.metadata || {}),
    });
    logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti.`);
}

export async function resetCollection() {
    // La funzione 'resetCollection' è disabilitata in configurazione Cloud per prevenire cancellazioni accidentali.
    if (process.env.CHROMA_DB_HOST && process.env.CHROMA_API_KEY) {
        logger.warn(`[ChromaDB] La funzione 'resetCollection' è disabilitata in configurazione Cloud per sicurezza.`);
        return;
    }
    
    const client = new ChromaClient({ host: '127.0.0.1', port: '8001' });
    await client.deleteCollection({ name: COLLECTION_NAME });
    // Forza il reset dello stato interno
    _collection = null;
    logger.log(`[ChromaDB] 🗑️ Collection "${COLLECTION_NAME}" resettata. Verrà ricreata al prossimo accesso.`);
}