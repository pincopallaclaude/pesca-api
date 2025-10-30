// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
        log(`[VectorService] Knowledge base saved to ${KB_FILE_PATH}`);
    } catch (error) {
        log(`[VectorService] ❌ ERROR saving knowledge base: ${error.message}`);
    }
}

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

// Assicurati che l'export sia completo
export {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase,
    saveKnowledgeBaseToFile,
    loadKnowledgeBaseFromFile
};