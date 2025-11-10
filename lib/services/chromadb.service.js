// lib/services/chromadb.service.js
import axios from 'axios';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js';

// --- LOG DI VERSIONE PER VERIFICARE IL DEPLOY ---
console.log("--- ESEGUO ChromaDB Service v.2.2 (con fix return Reranker) ---"); 

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

let _collectionInfo = null;
let _isInitializing = false;
let _initializationPromise = null;

async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🏠 Connessione e verifica collection '${COLLECTION_NAME}'...`);
        const response = await axios.get(`${CHROMA_API_URL}/collections`);
        let collectionData = response.data.find(c => c.name === COLLECTION_NAME);

        if (!collectionData) {
            logger.warn(`[ChromaDB] ⚠️ Collection non trovata. La creo...`);
            const createResponse = await axios.post(`${CHROMA_API_URL}/collections`, { name: COLLECTION_NAME });
            collectionData = createResponse.data;
        }

        if (!collectionData || !collectionData.id) throw new Error("Impossibile ottenere l'ID della collection.");
        _collectionInfo = { name: collectionData.name, id: collectionData.id };
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

export const initializeChromaDB = () => getCollectionInfo();
initializeChromaDB.getCollectionInfo = getCollectionInfo;

export async function queryKnowledgeBase(queryText, options = {}) {
    const { id: collectionId } = await getCollectionInfo();
    const { topK = 5, filters = null, useReranking = false, rerankTopK = 10 } = options;
    const initialDocsToFetch = useReranking ? Math.max(rerankTopK, topK, 15) : topK;

    const queryEmbedding = await getGeminiEmbeddings([queryText], 'RETRIEVAL_QUERY');
    const requestBody = {
        query_embeddings: queryEmbedding,
        n_results: initialDocsToFetch,
        where: filters || {},
        include: ['documents', 'metadatas', 'distances']
    };

    try {
        const response = await axios.post(`${CHROMA_API_URL}/collections/${collectionId}/query`, requestBody);
        const results = response.data;
        
        if (!results || !results.documents || !results.documents[0] || results.documents[0].length === 0) return [];
        const formattedResults = results.documents[0].map((doc, i) => ({
            content: doc,
            metadata: results.metadatas[0][i],
            similarity: 1 - results.distances[0][i]
        }));
        
        if (useReranking && formattedResults.length > 0) {
            const { rerankDocuments } = await import('./reranker.service.js');
            const rerankedResults = await rerankDocuments(queryText, formattedResults, topK);
            console.log("--- DEBUG CHROMADB: VALORE RICEVUTO DAL RERANKER ---");
            console.log(JSON.stringify(rerankedResults.slice(0, 2), null, 2)); // Stampa i primi 2 risultati ricevuti
            console.log("--- FINE DEBUG CHROMADB ---");            
            return rerankedResults; // La correzione chiave
        }
        
        return formattedResults.slice(0, topK);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore durante la query: ${error.message}`);
        if (error.response) console.error('Dettagli errore Axios:', error.response.data);
        return [];
    }
}

export async function addDocuments(documents) {
    if (!documents || documents.length === 0) return;
    const { id: collectionId } = await getCollectionInfo();
    const embeddings = await getGeminiEmbeddings(documents.map(d => d.content), 'RETRIEVAL_DOCUMENT');
    
    await axios.post(`${CHROMA_API_URL}/collections/${collectionId}/add`, {
        ids: documents.map(d => d.id),
        embeddings: embeddings,
        documents: documents.map(d => d.content),
        metadatas: documents.map(d => d.metadata || {}),
    });
    logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti.`);
}