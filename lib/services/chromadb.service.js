// lib/services/chromadb.service.js

import { CloudClient } from 'chromadb'; // Importa SOLO CloudClient
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
        logger.log(`[ChromaDB] ☁️ Connessione a ChromaDB Cloud...`);
        
        // La logica di connessione è ora unica e punta al Cloud
        const client = new CloudClient({
            apiKey: process.env.CHROMA_API_KEY,
            tenant: process.env.CHROMA_DB_HOST,
            database: 'pesca-api-db', 
        });
        
        _collection = await client.getOrCreateCollection({ 
            name: COLLECTION_NAME, 
            embeddingFunction: GeminiEmbeddingFunction 
        });
        
        const count = await _collection.count();
        logger.log(`[ChromaDB] ✅ Collection pronta con ${count} documenti.`);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        // Logga l'errore completo per il debug
        console.error(error);
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
    // La funzione 'resetCollection' è disabilitata per l'ambiente Cloud
    logger.warn(`[ChromaDB] La funzione 'resetCollection' è disabilitata in configurazione Cloud per sicurezza.`);
    return;
}