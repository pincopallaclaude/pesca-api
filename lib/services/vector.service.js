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
            const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            knowledgeBase = JSON.parse(data);
            // Sostituito console.log con log
            log(`[VectorService] Knowledge base loaded from ${KB_FILE_PATH}. Total documents: ${knowledgeBase.length}`);
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
 * @returns {Promise<object[]>} An array of the most relevant knowledge documents (content and similarity).
 */
async function queryKnowledgeBase(queryText, nResults = 5) {
  try {
    log(`[Vector Service] 🔍 Query ricevuta: "${queryText}"`);
    
    if (!knowledgeBase || knowledgeBase.length === 0) {
      log('[Vector Service] ⚠️ Knowledge Base vuota o non caricata!');
      return [];
    }

    // Genera embedding per la query
    const queryResult = await embeddingModel.embedContent({ content: { parts: [{ text: queryText }] } });
    const queryVector = queryResult.embedding.values;
    log(`[Vector Service] ✅ Embedding generato per query (dim: ${queryVector.length})`);

    // Funzione di similarità robusta
    const cosineSimilarity = (vecA, vecB) => {
        if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) {
            return 0;
        }
        let dotProduct = 0;
        let magnitudeA = 0;
        let magnitudeB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            magnitudeA += vecA[i] * vecA[i];
            magnitudeB += vecB[i] * vecB[i];
        }
        magnitudeA = Math.sqrt(magnitudeA);
        magnitudeB = Math.sqrt(magnitudeB);
        if (magnitudeA === 0 || magnitudeB === 0) {
            return 0;
        }
        const similarity = dotProduct / (magnitudeA * magnitudeB);
        return isNaN(similarity) ? 0 : similarity;
    };
    
    // Calcola similarità
    const similarities = knowledgeBase.map(doc => ({ 
        text: doc.content, // Usa 'content' come da nostra struttura KB
        similarity: cosineSimilarity(queryVector, doc.embedding) 
    }));

    // Ordina per similarità decrescente
    similarities.sort((a, b) => b.similarity - a.similarity);

    // Soglia di similarità per filtrare i risultati
    const threshold = 0.4;
    
    // LOG DETTAGLIATO DELLE TOP 5 SIMILARITÀ
    log(`[Vector Service] 📊 Top 5 similarità:`);
    similarities.slice(0, 5).forEach((s, i) => {
      log(`  ${i+1}. Score: ${s.similarity.toFixed(4)} | Text: ${(s.text || '').substring(0, 80)}...`);
    });

    // Filtra e prepara i risultati
    const results = similarities
      .filter(item => item.similarity >= threshold)
      .map(item => ({ text: item.text, similarity: item.similarity })); // Ritorna l'oggetto { text, similarity }

    log(`[Vector Service] ✅ Risultati con threshold >= ${threshold}: ${results.length}`);
    
    if (results.length === 0 && similarities.length > 0) {
      log(`[Vector Service] ⚠️ Nessun risultato trovato! Max similarity era: ${similarities[0]?.similarity.toFixed(4)}`);
    }

    // Ritorna i top K risultati (inclusa la similarità, come richiesto dalla nuova struttura)
    return results.slice(0, nResults);
    
  } catch (error) {
    log(`[Vector Service] ❌ Errore durante la query: ${error.message}`);
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
