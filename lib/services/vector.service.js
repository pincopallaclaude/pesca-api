// /lib/services/vector.service.js
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
    
    console.log(`[VectorService] Populated in-memory JS array with ${knowledgeBase.length} documents.`);
}

/**
 * Queries the in-memory JS array using la similarità del coseno (simulazione RAG).
 * @param {string} queryText - The text to search for.
 * @param {number} nResults - The number of results to return.
 * @returns {Promise<string[]>} An array of the most relevant knowledge documents (content only).
 */
async function queryKnowledgeBase(queryText, nResults = 2) {
    if (!queryText || knowledgeBase.length === 0) return [];

    try {
        // 1. Genera l'embedding per la query
        // CORREZIONE: Usiamo la sintassi a oggetto messaggio per una compatibilità API più robusta.
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
            .map(result => result.document);
        
        console.log(`[VectorService] Found ${results.length} relevant documents via JS array search.`);
        return results;

    } catch (error) {
        // Registra l'errore API (come il 400 Bad Request) e ritorna un array vuoto
        console.error('[VectorService] ERROR querying index:', error.message);
        return [];
    }
}

module.exports = {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase
};