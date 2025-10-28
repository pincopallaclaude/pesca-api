// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url'; // Import necessario per la gestione dei percorsi in ESM

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

// --- Gestione dei percorsi ESM (Sostituzione di __dirname) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// -----------------------------------------------------------

const EMBEDDING_DIMENSION = 768; 

// Inizializza Google AI per gli embeddings
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Struttura dati in-memory: array di oggetti che contiene documento e vettore.
let knowledgeBase = []; 

/**
 * Funzione per popolare la base di conoscenza in-memory.
 * @param {object[]} docs - Array di oggetti documento ({ content: string, name: string, ... })
 * @param {number[][]} embeddings - Array di vettori (embeddings)
 */
function populateIndex(docs, embeddings) {
    // Combina i documenti con i loro vettori in un unico array
    knowledgeBase = docs.map((doc, index) => ({
        ...doc,
        embedding: embeddings[index],
    }));
    
    // Sostituito console.log con log
    log(`[VectorService] Populated in-memory JS array with ${knowledgeBase.length} documents.`);
}


// KB_FILE_PATH ora usa il nuovo __dirname
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

/**
 * Saves the current in-memory knowledge base to a JSON file.
 */
function saveKnowledgeBaseToFile() {
    if (knowledgeBase.length === 0) {
        // Sostituito console.warn con log
        log('[VectorService] ⚠️ Knowledge base is empty. Nothing to save.');
        return;
    }
    try {
        const data = JSON.stringify(knowledgeBase, null, 2);
        fs.writeFileSync(KB_FILE_PATH, data, 'utf-8');
        // Sostituito console.log con log
        log(`[VectorService] Knowledge base successfully saved to ${KB_FILE_PATH}`);
    } catch (error) {
        // Sostituito console.error con log
        log(`[VectorService] ❌ ERROR saving knowledge base to file: ${error.message}`);
    }
}

/**
 * Loads the knowledge base from a JSON file into memory on server startup.
 */
function loadKnowledgeBaseFromFile() {
    try {
        if (fs.existsSync(KB_FILE_PATH)) {
            const rawData = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            const parsedData = JSON.parse(rawData);

            // Controlla se il file è nel nuovo formato { docs: [], embeddings: [] }
            if (parsedData.docs && parsedData.embeddings && Array.isArray(parsedData.docs)) {
                // Se è nel nuovo formato, ricostruisci la struttura interna
                populateIndex(parsedData.docs, parsedData.embeddings);
                log(`[VectorService] Knowledge base loaded and re-indexed from ${KB_FILE_PATH}. Total documents: ${knowledgeBase.length}`);
            } else if (Array.isArray(parsedData) && parsedData[0]?.embedding) {
                // Gestisce la retrocompatibilità se il file è già nel formato interno
                knowledgeBase = parsedData;
                log(`[VectorService] Knowledge base loaded directly from ${KB_FILE_PATH}. Total documents: ${knowledgeBase.length}`);
            } else {
                 throw new Error("Formato di knowledge_base.json non riconosciuto.");
            }
        } else {
            // Sostituito console.warn con log
            log(`[VectorService] ⚠️ knowledge_base.json not found. The AI will operate without a knowledge base.`);
        }
    } catch (error) {
        // Sostituito console.error con log
        log(`[VectorService] ❌ ERROR loading knowledge base from file: ${error.message}`);
    }
}


/**
 * Queries the in-memory JS array using la similarità del coseno (simulazione RAG).
 * @param {string} queryText - The text to search for.
 * @param {number} nResults - The number of results to return.
 * @returns {Promise<object[]>} An array of the most relevant knowledge documents ({ text: string, similarity: number }).
 */
async function queryKnowledgeBase(queryText, nResults = 2) {
    if (!queryText || knowledgeBase.length === 0) return [];

    try {
        // 1. Genera l'embedding per la query
        const queryResult = await embeddingModel.embedContent({ 
            content: { parts: [{ text: queryText }] }
        });
        const queryVector = queryResult.embedding.values;

        // Funzione per calcolare la similarità del coseno
        const cosineSimilarity = (vecA, vecB) => {
            const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
            // Previene la divisione per zero se una magnitudine è 0 (improbabile con vettori reali)
            return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
        };

        // 2. Calcola la similarità per ogni documento e ordina
        const results = knowledgeBase
            .map(doc => ({
                document: doc.content,
                similarity: cosineSimilarity(queryVector, doc.embedding),
            }))
            .sort((a, b) => b.similarity - a.similarity) // Ordina per similarità decrescente
            .slice(0, nResults)
            // Restituisce l'intero oggetto documento, non solo il testo
            .map(result => ({ text: result.document, similarity: result.similarity })); 
        
        // Sostituito console.log con log
        log(`[VectorService] Found ${results.length} relevant documents via JS array search.`);
        return results;

    } catch (error) {
        // Registra l'errore API (come il 400 Bad Request) e ritorna un array vuoto
        // Sostituito console.error con log
        log(`[VectorService] ❌ ERROR querying index: ${error.message}`);
        return [];
    }
}

export {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase,
    saveKnowledgeBaseToFile,
    loadKnowledgeBaseFromFile
};
