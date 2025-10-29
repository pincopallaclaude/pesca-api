// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HierarchicalNSW } from 'hnswlib-node'; // <-- IMPORTA LA LIBRERIA CORRETTA

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBEDDING_DIMENSION = 768;
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Variabili globali per l'indice e i dati
let index;
let documents = [];

/**
 * Carica la KB dal file e costruisce l'indice HNSW in memoria.
 */
function loadKnowledgeBaseFromFile() {
    try {
        if (!fs.existsSync(KB_FILE_PATH)) {
            log(`[VectorService] ⚠️ knowledge_base.json not found.`);
            return;
        }

        const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
        const knowledgeBase = JSON.parse(data);
        documents = knowledgeBase;

        if (documents.length === 0) {
            log('[VectorService] ⚠️ Knowledge base is empty.');
            return;
        }

        // Inizializza l'indice
        index = new HierarchicalNSW('cosine', EMBEDDING_DIMENSION);
        index.initIndex(documents.length);

        // Aggiungi i vettori all'indice
        for (let i = 0; i < documents.length; i++) {
            if (documents[i].embedding && Array.isArray(documents[i].embedding)) {
                index.addPoint(documents[i].embedding, i);
            }
        }

        log(`[VectorService] ✅ HNSW index built successfully with ${documents.length} documents.`);
    } catch (error) {
        log(`[VectorService] ❌ ERROR loading knowledge base or building index: ${error.message}`);
    }
}

/**
 * Interroga l'indice HNSW.
 * @param {string} queryText - Il testo da cercare.
 * @param {number} nResults - Il numero di risultati.
 * @returns {Promise<object[]>} Un array di oggetti documento.
 */
async function queryKnowledgeBase(queryText, nResults = 5) {
    if (!index || documents.length === 0 || !queryText) {
        log('[VectorService] ⚠️ Index not ready or query is empty. Returning 0 results.');
        return [];
    }

    try {
        // 1. Genera il vettore per la query
        const queryResult = await embeddingModel.embedContent({
            content: { parts: [{ text: queryText }], role: "user" }
        });
        const queryVector = queryResult.embedding.values;

        // 2. Cerca nell'indice i vicini più prossimi
        const searchResult = index.searchKnn(queryVector, nResults);
        
        // 3. Mappa gli indici trovati ai documenti originali
        const results = searchResult.neighbors.map(neighborIndex => {
            const doc = documents[neighborIndex];
            return {
                text: doc.content,
                source: doc.source,
                // Puoi aggiungere la distanza se necessario per il debug
                // distance: searchResult.distances[searchResult.neighbors.indexOf(neighborIndex)]
            };
        });
        
        log(`[VectorService] Found ${results.length} relevant documents via HNSW search.`);
        return results;

    } catch (error) {
        log(`[VectorService] ❌ ERROR querying HNSW index: ${error.message}`);
        return [];
    }
}

// Esporta solo le funzioni necessarie pubblicamente
export {
    loadKnowledgeBaseFromFile,
    queryKnowledgeBase
};