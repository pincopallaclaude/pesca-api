// lib/services/chromadb.service.js

import { ChromaClient } from 'chromadb';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

let _collection = null;
let _isInitializing = false;
let _initializationPromise = null;

const GeminiEmbeddingFunction = {
    embedDocuments: async (texts) => {
        logger.log(`[ChromaEmbed] Vettorizzo ${texts.length} documenti (Document)...`);
        return await getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT');
    },
    embedQuery: async (texts) => {
        logger.log(`[ChromaEmbed] Vettorizzo ${texts.length} query (Query)...`);
        return await getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY');
    },
};

async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🔌 Tentativo di connessione a ChromaDB...`);
        const client = new ChromaClient({
            host: process.env.CHROMA_DB_HOST,
            port: process.env.CHROMA_DB_PORT,
            ssl: false
        });
        
        await client.heartbeat();
        logger.log(`[ChromaDB] ✅ Server alive.`);
        
        _collection = await client.getOrCreateCollection({ 
            name: COLLECTION_NAME, 
            embeddingFunction: GeminiEmbeddingFunction 
        });
        
        const count = await _collection.count();
        logger.log(`[ChromaDB] ✅ Collection "${COLLECTION_NAME}" pronta con ${count} documenti.`);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
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
        logger.error('[ChromaDB] ❌ getCollection fallita dopo attesa della promise.');
        throw new Error('Inizializzazione di ChromaDB fallita in modo critico.');
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
        where: Object.keys(whereClause).length > 0 ? whereClause : undefined, // CORREZIONE: Usa undefined se vuoto
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
    logger.log(`[ChromaDB] 🧹 Tentativo di reset della collection "${COLLECTION_NAME}"...`);
    
    // Garantisce che _collection sia stato inizializzato e che i parametri ENV siano validi.
    await getCollection();
    
    const client = new ChromaClient({ host: process.env.CHROMA_DB_HOST, port: process.env.CHROMA_DB_PORT });
    
    await client.deleteCollection({ name: COLLECTION_NAME });
    
    // Forza la ri-creazione della collection e aggiorna la variabile singleton _collection
    _collection = await client.getOrCreateCollection({ name: COLLECTION_NAME, embeddingFunction: GeminiEmbeddingFunction });
    
    logger.log(`[ChromaDB] ✅ Collection "${COLLECTION_NAME}" ricreata e pronta.`);
}