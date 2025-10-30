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
        // *** IMPORTANTE: Memorizziamo direttamente l'array di valori del vettore ***
        embedding: embeddings[index], 
        // Assicuriamoci che 'source' sia disponibile se usato in queryKnowledgeBase
        source: doc.name || 'unknown'
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
            const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            knowledgeBase = JSON.parse(data);
            
            // 🔥 LOG DIAGNOSTICI AGGIUNTI
            log(`[Vector Service] ✅ KB caricata: ${knowledgeBase.length} documenti`);
            
            if (knowledgeBase.length === 0) {
              log('[Vector Service] ⚠️ ATTENZIONE: Knowledge Base VUOTA!');
            } else if (knowledgeBase.length > 0) {
              // Logga un campione per verificare il contenuto e la struttura
              const sampleDoc = knowledgeBase[0];
              // Verifica che 'content' esista prima di chiamare substring
              log(`[Vector Service] 📄 Esempio documento (prime 100 chars): ${sampleDoc.content?.substring(0, 100)}...`);
              // Verifica che l'embedding sia un array e che abbia elementi
              log(`[Vector Service] 📄 Esempio embedding (ha valori?): ${Array.isArray(sampleDoc.embedding) && sampleDoc.embedding.length > 0}`);
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
 * @returns {Promise<object[]>} An array of the most relevant knowledge documents (oggetto completo).
 */
async function queryKnowledgeBase(queryText, nResults = 5) {
    if (!queryText || knowledgeBase.length === 0) return [];

    try {
        // 1. Genera l'embedding per la query (richiede la struttura parts: [{ text: ... }])
        const queryResult = await embeddingModel.embedContent({ 
            content: { parts: [{ text: queryText }] }
        });
        const queryVector = queryResult.embedding.values;

        // Funzione per calcolare la similarità del coseno
        const cosineSimilarity = (vecA, vecB) => {
            const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
            // Previene la divisione per zero se una magnitudine è 0
            return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
        };

        // 2. Calcola la similarità per ogni documento, filtra e ordina
        const results = knowledgeBase.map(doc => {
            // ACCESSO DIRETTO: doc.embedding è già l'array di cui abbiamo bisogno (popolateIndex)
            const docVector = doc.embedding;

            // Controllo di sicurezza
            if (!Array.isArray(docVector) || !Array.isArray(queryVector)) {
                 // Ritorna un risultato con similarità -1 per l'eliminazione
                 return { similarity: -1 };
            }

            return {
                text: doc.content, // Usa 'text' per coerenza con il resto dell'app
                source: doc.source,  // Usa 'source' (popolato in populateIndex)
                similarity: cosineSimilarity(queryVector, docVector)
            };
        })
        .filter(result => result.similarity > 0.7) // Filtra per una soglia minima di rilevanza (RAG FILTER)
        .sort((a, b) => b.similarity - a.similarity) // Ordina per similarità decrescente
        .slice(0, nResults); // Estrae i top N risultati
        
        log(`[VectorService] Found ${results.length} relevant documents (min similarity > 0.7).`);
        return results;

    } catch (error) {
        // Registra l'errore API (come il 400 Bad Request) e ritorna un array vuoto
        log(`[VectorService] ❌ ERROR querying index: ${error.message}`);
        return [];
    }
}

// Funzione di utilità per l'inizializzazione che usa il pattern dei moduli (esporta la funzione, non viene chiamata qui)
async function initKnowledgeBase() {
    loadKnowledgeBaseFromFile();
}

export {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase,
    saveKnowledgeBaseToFile,
    initKnowledgeBase, // Esportata per l'uso in server.js
    // Non esportiamo più loadKnowledgeBaseFromFile, usiamo initKnowledgeBase
};
