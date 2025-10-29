// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const EMBEDDING_DIMENSION = 768;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

let knowledgeBase = [];

function populateIndex(docs, embeddings) {
    knowledgeBase = docs.map((doc, index) => ({
        ...doc,
        embedding: embeddings[index],
        source: doc.name || 'unknown'
    }));
    log(`[VectorService] Populated in-memory JS array with ${knowledgeBase.length} documents.`);
}

const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

function saveKnowledgeBaseToFile() {
    if (knowledgeBase.length === 0) {
        log('[VectorService] ⚠️ Knowledge base is empty. Nothing to save.');
        return;
    }
    try {
        const data = JSON.stringify(knowledgeBase, null, 2);
        fs.writeFileSync(KB_FILE_PATH, data, 'utf-8');
        log(`[VectorService] Knowledge base successfully saved to ${KB_FILE_PATH}`);
    } catch (error) {
        log(`[VectorService] ❌ ERROR saving knowledge base to file: ${error.message}`);
    }
}

function loadKnowledgeBaseFromFile() {
    try {
        if (fs.existsSync(KB_FILE_PATH)) {
            const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            knowledgeBase = JSON.parse(data);

            // --- LOG DIAGNOSTICI RICHIESTI (SOLUZIONE 4) ---
            log(`[Vector Service] ✅ KB caricata: ${knowledgeBase.length} documenti`);
            if (knowledgeBase.length === 0) {
                log('[Vector Service] ⚠️ ATTENZIONE: Knowledge Base VUOTA!');
            } else {
                log(`[Vector Service] 📄 Esempio documento: ${knowledgeBase[0].content?.substring(0, 100) || 'Contenuto non disponibile'}`);
            }
            // --- FINE LOG DIAGNOSTICI ---

        } else {
            log(`[VectorService] ⚠️ knowledge_base.json not found. The AI will operate without a knowledge base.`);
        }
    } catch (error) {
        log(`[VectorService] ❌ ERROR loading knowledge base from file: ${error.message}`);
    }
}

async function queryKnowledgeBase(queryText, nResults = 5) {
    if (!queryText || knowledgeBase.length === 0) return [];

    try {
        const queryResult = await embeddingModel.embedContent({
            content: { parts: [{ text: queryText }] }
        });
        const queryVector = queryResult.embedding.values;

        const cosineSimilarity = (vecA, vecB) => {
            const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
            return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
        };

        const results = knowledgeBase.map(doc => {
            const docVector = doc.embedding;
            if (!Array.isArray(docVector) || !Array.isArray(queryVector)) {
                return { similarity: -1 };
            }
            return {
                text: doc.content,
                source: doc.source,
                similarity: cosineSimilarity(queryVector, docVector)
            };
        })
        .filter(result => result.similarity > 0.7)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, nResults);
        
        log(`[VectorService] Found ${results.length} relevant documents (min similarity > 0.7).`);
        return results;
    } catch (error) {
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