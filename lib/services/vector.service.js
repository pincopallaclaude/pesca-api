// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Funzione di logging unificata
const log = (msg) => process.stderr.write(`${msg}\n`);

// --- Gestione dei percorsi ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ----------------------------------

// Inizializza Google AI per gli embeddings
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Struttura dati in-memory
let knowledgeBase = []; 

/**
 * Funzione per popolare la base di conoscenza in-memory.
 * @param {object[]} docs - Array di oggetti documento ({ content: string, name: string, ... })
 * @param {number[][]} embeddings - Array di vettori (embeddings)
 */
function populateIndex(docs, embeddings) {
    knowledgeBase = docs.map((doc, index) => ({
        ...doc,
        // Memorizziamo l'array di valori del vettore
        embedding: embeddings[index],
        // Assicuriamo che 'source' sia disponibile
        source: doc.name || 'unknown'
    }));
    log(`[VectorService] Populated in-memory JS array with ${knowledgeBase.length} documents.`);
}

const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

/**
 * Saves the current in-memory knowledge base to a JSON file.
 */
function saveKnowledgeBaseToFile() {
    if (knowledgeBase.length === 0) {
        log('[VectorService] ⚠️ Knowledge base is empty. Nothing to save.');
        return;
    }
    try {
        const data = JSON.stringify(knowledgeBase, null, 2);
        fs.writeFileSync(KB_FILE_PATH, data, 'utf-8');
        log(`[VectorService] Knowledge base saved to ${KB_FILE_PATH}`);
    } catch (error) {
        log(`[VectorService] ❌ ERROR saving knowledge base: ${error.message}`);
    }
}

/**
 * Loads the knowledge base from a JSON file into memory on server startup.
 */
function loadKnowledgeBaseFromFile() {
    try {
        if (fs.existsSync(KB_FILE_PATH)) {
            const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            knowledgeBase = JSON.parse(data);
            
            log(`[Vector Service] ✅ KB caricata: ${knowledgeBase.length} documenti`);
            if (knowledgeBase.length === 0) {
              log('[Vector Service] ⚠️ ATTENZIONE: Knowledge Base VUOTA!');
            } else if (knowledgeBase.length > 0) {
              const sampleDoc = knowledgeBase[0];
              log(`[Vector Service] 📄 Esempio documento: ${sampleDoc.content?.substring(0, 100)}...`);
              log(`[Vector Service] 📄 Esempio embedding: ${Array.isArray(sampleDoc.embedding) && sampleDoc.embedding.length > 0}`);
            }
        } else {
            log(`[VectorService] ⚠️ knowledge_base.json not found.`);
        }
    } catch (error) {
        log(`[VectorService] ❌ ERROR loading knowledge base: ${error.message}`);
    }
}

/**
 * Queries the in-memory JS array using la similarità del coseno (simulazione RAG).
 * @param {string} queryText - The text to search for.
 * @param {number} nResults - The number of results to return.
 * @returns {Promise<object[]>} An array of the most relevant knowledge documents (oggetto completo).
 */
async function queryKnowledgeBase(queryText, nResults = 5) {
    if (!queryText || knowledgeBase.length === 0) return [];
    try {
        const queryResult = await embeddingModel.embedContent({ content: { parts: [{ text: queryText }] } });
        const queryVector = queryResult.embedding.values;

        const cosineSimilarity = (vecA, vecB) => {
            if (!vecA || !vecB) return 0;
            const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
            return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
        };

        const allSimilarities = knowledgeBase.map(doc => ({
            text: doc.content,
            source: doc.source,
            similarity: cosineSimilarity(queryVector, doc.embedding)
        }));

        allSimilarities.sort((a, b) => b.similarity - a.similarity);

        const threshold = 0.6;
        const results = allSimilarities.filter(item => item.similarity >= threshold);

        log(`[Vector Service] 🔍 Query: "${queryText}"`);
        log(`[Vector Service] 📊 Top 3 similarities: ${allSimilarities.slice(0, 3).map(s => s.similarity.toFixed(3)).join(', ')}`);
        log(`[Vector Service] ✅ Trovati ${results.length} risultati con similarità >= ${threshold}`);
        
        return results.slice(0, nResults);

    } catch (error) {
        log(`[VectorService] ❌ ERRORE querying index: ${error.message}`);
        return [];
    }
}

// initKnowledgeBase non è più esportata, ma loadKnowledgeBaseFromFile sì.
async function initKnowledgeBase() {
    loadKnowledgeBaseFromFile();
}

// Esportazioni principali
export {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase,
    saveKnowledgeBaseToFile,
    loadKnowledgeBaseFromFile // Mantenuta esportata per controllo esterno
};
