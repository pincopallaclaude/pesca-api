// lib/services/chromadb.service.js

import axios from 'axios';
import 'dotenv/config';
import * as logger from '../utils/logger.js';
import { getGeminiEmbeddings } from './gemini.service.js'; 

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';

// Definiamo entrambe le collezioni che devono esistere nel database
const REQUIRED_COLLECTIONS = ['fishing_knowledge', 'fishing_episodes'];

let _collections = {}; // Memorizzerà { name: { name: '...', id: '...' } }
let _isInitializing = false;
let _initializationPromise = null;

/**
 * Inizializza o verifica l'esistenza di tutte le collezioni richieste.
 */
async function _initialize() {
    try {
        logger.log(`[ChromaDB] 🏠 Connessione e verifica di ${REQUIRED_COLLECTIONS.join(' e ')}...`);
        
        // 1. Ottieni tutte le collezioni esistenti
        const response = await axios.get(`${CHROMA_API_URL}/collections`);
        const existingCollections = response.data;

        for (const name of REQUIRED_COLLECTIONS) {
            let collectionData = existingCollections.find(c => c.name === name);

            if (!collectionData) {
                logger.warn(`[ChromaDB] ⚠️ Collezione '${name}' non trovata. La creo...`);
                // 2. Crea la collezione se non esiste
                const createResponse = await axios.post(`${CHROMA_API_URL}/collections`, { name });
                collectionData = createResponse.data;
            }

            if (!collectionData || !collectionData.id) {
                throw new Error(`Impossibile ottenere l'ID per la collezione: ${name}`);
            }
            
            _collections[name] = { name: collectionData.name, id: collectionData.id };
            logger.log(`[ChromaDB] ✅ Collezione '${name}' inizializzata. ID: ${collectionData.id}`);
        }

        logger.log('[ChromaDB] ✅ Inizializzazione di tutte le collezioni completata.');

    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore critico durante l'inizializzazione: ${error.message}`);
        _collections = {}; 
        throw error;
    }
}

/**
 * Restituisce l'ID e il nome della collezione specificata.
 * @param {string} name - Il nome della collezione ('fishing_knowledge' o 'fishing_episodes').
 * @returns {Promise<{name: string, id: string}>} Informazioni sulla collezione.
 */
async function getCollectionInfo(name) {
    if (_collections[name]) return _collections[name];
    
    if (!_isInitializing) {
        _isInitializing = true;
        _initializationPromise = _initialize().finally(() => { _isInitializing = false; });
    }
    await _initializationPromise;

    if (!_collections[name]) {
        throw new Error(`Inizializzazione ChromaDB fallita: la collezione '${name}' non è disponibile.`);
    }
    return _collections[name];
}

// Esportazioni principali
export const initializeChromaDB = () => getCollectionInfo(REQUIRED_COLLECTIONS[0]);
initializeChromaDB.getCollectionInfo = getCollectionInfo; // Espongo la funzione per accedere a tutte le collezioni

export async function queryKnowledgeBase(queryText, options = {}) {
    // Otteniamo l'ID corretto per 'fishing_knowledge'
    const { id: collectionId } = await getCollectionInfo('fishing_knowledge'); 
    
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
            return rerankedResults; 
        }
        
        return formattedResults.slice(0, topK);
    } catch (error) {
        logger.error(`[ChromaDB] ❌ Errore durante la query: ${error.message}`);
        if (error.response) console.error('Dettagli errore Axios:', error.response.data);
        return [];
    }
}

export async function addDocuments(documents, collectionName = 'fishing_knowledge') {
    if (!documents || documents.length === 0) return;
    // Otteniamo l'ID corretto in base al nome fornito (default è fishing_knowledge)
    const { id: collectionId } = await getCollectionInfo(collectionName); 
    
    const embeddings = await getGeminiEmbeddings(documents.map(d => d.content), 'RETRIEVAL_DOCUMENT');
    
    await axios.post(`${CHROMA_API_URL}/collections/${collectionId}/add`, {
        ids: documents.map(d => d.id),
        embeddings: embeddings,
        documents: documents.map(d => d.content),
        metadatas: documents.map(d => d.metadata || {}),
    });
    logger.log(`[ChromaDB] ✅ Aggiunti ${documents.length} documenti alla collezione '${collectionName}'.`);
}