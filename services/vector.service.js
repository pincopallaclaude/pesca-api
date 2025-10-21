// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Helper per ottenere __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

let knowledgeBase = [];
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

/**
 * Calcola la similarità del coseno tra due vettori.
 * @param {number[]} vecA - Vettore A.
 * @param {number[]} vecB - Vettore B.
 * @returns {number} Similarità tra 0 e 1.
 */
const cosineSimilarity = (vecA, vecB) => {
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
};

const vectorService = {
    /**
     * Carica la knowledge base da file in memoria.
     */
    loadKnowledgeBaseFromFile() {
        try {
            if (fs.existsSync(KB_FILE_PATH)) {
                const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
                knowledgeBase = JSON.parse(data);
                console.log(`[VectorService] Knowledge base loaded. Total documents: ${knowledgeBase.length}`);
            } else {
                console.warn(`[VectorService] knowledge_base.json not found.`);
            }
        } catch (error) {
            console.error('[VectorService] ERROR loading knowledge base:', error);
        }
    },

    /**
     * Esegue una ricerca per similarità semantica.
     * @param {string} queryText - Il testo da cercare.
     * @param {number} topK - Il numero di risultati da restituire.
     * @returns {Promise<object[]>} Un array di oggetti risultato con contenuto, similarità e metadati.
     */
    async searchSimilar(queryText, topK = 5) {
        if (!queryText || knowledgeBase.length === 0) return [];
        try {
            const queryResult = await embeddingModel.embedContent({
                content: { parts: [{ text: queryText }] }
            });
            const queryVector = queryResult.embedding.values;

            const results = knowledgeBase
                .map(doc => ({
                    content: doc.content,
                    similarity: cosineSimilarity(queryVector, doc.embedding),
                    metadata: doc.metadata || {}, // Assicura che metadata esista
                }))
                .sort((a, b) => b.similarity - a.similarity)
                .slice(0, topK);
            
            console.log(`[VectorService] Found ${results.length} relevant documents.`);
            return results;
        } catch (error) {
            console.error('[VectorService] ERROR querying index:', error.message);
            return [];
        }
    }
};

export { vectorService };