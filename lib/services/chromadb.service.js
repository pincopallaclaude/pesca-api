// lib/services/chromadb.service.js

import axios from 'axios';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

console.log("--- ESEGUO ChromaDB Service v.2.0 (con fix UUID) ---"); 

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

let _collectionInfo = null; // <-- Ora salviamo nome E ID
let _isInitializing = false;
let _initializationPromise = null;

const GeminiEmbeddingFunction = {
    embedDocuments: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_DOCUMENT'),
    embedQuery: (texts) => getGeminiEmbeddings(texts, 'RETRIEVAL_QUERY'),
};

async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🏠 Connessione e verifica collection '${COLLECTION_NAME}'...`);
        let collectionData;

        // 1. Lista tutte le collection per trovare la nostra
        const response = await axios.get(`${CHROMA_API_URL}/collections`);
        collectionData = response.data.find(c => c.name === COLLECTION_NAME);

        // 2. Se non esiste, creala e recupera i suoi dati
        if (!collectionData) {
            logger.warn(`[ChromaDB] ⚠️ Collection non trovata. La creo...`);
            const createResponse = await axios.post(`${CHROMA_API_URL}/collections`, { name: COLLECTION_NAME });
            collectionData = createResponse.data;
            logger.log(`[ChromaDB] ✅ Collection '${COLLECTION_NAME}' creata.`);
        } else {
            logger.log(`[ChromaDB] ✅ Collection già esistente.`);
        }

        if (!collectionData || !collectionData.id) {
            throw new Error("Impossibile ottenere l'ID della collection dopo la creazione/verifica.");
        }

        // 3. Salva le informazioni (nome e ID)
        _collectionInfo = {
            name: collectionData.name,
            id: collectionData.id, // <-- SALVIAMO L'ID!
        };
        
        logger.log(`[ChromaDB] ✅ Inizializzazione completata. ID: ${_collectionInfo.id}`);

    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        _collectionInfo = null;
        throw error;
    }
}

async function getCollectionInfo() {
    if (_collectionInfo) return _collectionInfo;
    if (!_isInitializing) {
        _isInitializing = true;
        _initializationPromise = _initialize().finally(() => { _isInitializing = false; });
    }
    await _initializationPromise;
    if (!_collectionInfo) throw new Error('Inizializzazione ChromaDB fallita.');
    return _collectionInfo;
}

export const initializeChromaDB = getCollectionInfo;

export async function queryKnowledgeBase(queryText, options = {}) {
    const { id: collectionId } = await getCollectionInfo(); // <-- OTTIENI L'ID
    
    // ... (logica per topK, filtri, etc. rimane uguale)
    const { topK = 5, filters = null, useReranking = false, rerankTopK = 10 } = options;
    const initialDocsToFetch = useReranking ? Math.max(rerankTopK, topK) : topK;

    const queryEmbedding = await GeminiEmbeddingFunction.embedQuery([queryText]);
    const requestBody = {
        query_embeddings: queryEmbedding,
        n_results: initialDocsToFetch,
        where: filters || {},
        include: ['documents', 'metadatas', 'distances']
    };

    try {
        // --- MODIFICA CHIAVE: USA L'ID NELL'URL ---
        const response = await axios.post(`${CHROMA_API_URL}/collections/${collectionId}/query`, requestBody);
        const results = response.data;
        // ... (il resto della logica di formattazione rimane uguale)
        if (!results || !results.documents || !results.documents[0] || results.documents[0].length === 0) return [];
        const formattedResults = results.documents[0].map((doc, i) => ({ content: doc, metadata: results.metadatas[0][i], similarity: 1 - results.distances[0][i] }));
        if (useReranking && formattedResults.length > 0) {
            const { rerankDocuments } = await import('./reranker.service.js');
            return await rerankDocuments(queryText, formattedResults, topK);
        }
        return formattedResults.slice(0, topK);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore durante la query: ${error.message}`);
        if (error.response) console.error('Dettagli errore Axios:', error.response.data);
        return [];
    }
}

export async function addDocuments(documents) {
    if (documents.length === 0) return;
    const { id: collectionId } = await getCollectionInfo(); // <-- OTTIENI L'ID

    const embeddings = await GeminiEmbeddingFunction.embedDocuments(documents.map(d => d.content));
    
    // --- MODIFICA CHIAVE: USA L'ID NELL'URL ---
    await axios.post(`${CHROMA_API_URL}/collections/${collectionId}/add`, {
        ids: documents.map(d => d.id),
        embeddings: embeddings,
        documents: documents.map(d => d.content),
        metadatas: documents.map(d => d.metadata || {}),
    });
    logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti.`);
}

export async function resetCollection() {
    // Il reset funziona con il NOME, non con l'ID
    logger.log(`[ChromaDB] ⏳ Tentativo di reset della Collection "${COLLECTION_NAME}"...`);
    try {
        await axios.delete(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}`);
        logger.log(`[ChromaDB] 🗑️ Collection "${COLLECTION_NAME}" resettata.`);
    } catch (e) {
        if (e.response && (e.response.status === 404 || e.response.data?.error?.includes("does not exist"))) {
            logger.log(`[ChromaDB] ⚠️ Collection non esistente (OK).`);
        } else {
             logger.error(`[ChromaDB] ❌ Errore durante il reset: ${e.message}`);
             throw e;
        }
    }
    _collectionInfo = null;
}