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
const KB_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

function saveKnowledgeBaseToFile() {
    try {
        fs.writeFileSync(KB_PATH, JSON.stringify(knowledgeBase, null, 2), 'utf-8');
        log(`[VectorService] Knowledge base saved to ${KB_PATH}`);
    } catch (error) {
        log(`[VectorService] ❌ ERROR saving knowledge base: ${error.message}`);
    }
}

function loadKnowledgeBaseFromFile() {
    try {
        if (fs.existsSync(KB_PATH)) {
            const data = fs.readFileSync(KB_PATH, 'utf-8');
            knowledgeBase = JSON.parse(data);
            
            // --- LOG DIAGNOSTICO AGGIUNTO ---
            log(`[VectorService] ✅ KB caricata: ${knowledgeBase.length} documenti`);
            if (knowledgeBase.length === 0) {
                log('[VectorService] ⚠️ ATTENZIONE: Knowledge Base VUOTA!');
            } else {
                log(`[VectorService] 📄 Esempio documento: ${knowledgeBase[0]?.content?.substring(0, 100) || 'N/A'}...`);
            }
            // --- FINE LOG ---
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
        const queryResult = await embeddingModel.embedContent({ 
            content: { parts: [{ text: queryText }] }
        });
        const queryVector = queryResult.embedding.values;

        const cosineSimilarity = (vecA, vecB) => {
            if (!vecA || !vecB) return 0;
            const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
            const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
            const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
            return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
        };

        const similarities = knowledgeBase
            .map(doc => ({
                text: doc.content, // Cambiato da "document" a "text" per coerenza con l'output atteso
                similarity: cosineSimilarity(queryVector, doc.embedding),
            }))
            .sort((a, b) => b.similarity - a.similarity);

        // --- FILTRO PER SOGLIA DI SIMILARITÀ AGGIUNTO ---
        const threshold = 0.6; // Soglia ragionevole per iniziare
        const results = similarities
            .filter(item => item.similarity >= threshold)
            .slice(0, nResults);
        
        // --- LOG DIAGNOSTICO AGGIUNTO ---
        log(`[VectorService] 🔍 Query: "${queryText}"`);
        log(`[VectorService] 📊 Top 3 similarities: [${similarities.slice(0, 3).map(s => s.similarity.toFixed(3)).join(', ')}]`);
        log(`[VectorService] ✅ Risultati trovati >= ${threshold}: ${results.length}`);
        
        return results;

    } catch (error) {
        log(`[VectorService] ❌ ERROR querying index: ${error.message}`);
        return [];
    }
}

// Funzione di populate non più usata dal flusso principale, ma la manteniamo
function populateIndex(docs, embeddings) {
    knowledgeBase = docs.map((doc, index) => ({
        ...doc,
        embedding: embeddings[index],
    }));
    log(`[VectorService] Populated in-memory JS array with ${knowledgeBase.length} documents.`);
}

export {
    embeddingModel,
    populateIndex,
    queryKnowledgeBase,
    saveKnowledgeBaseToFile,
    loadKnowledgeBaseFromFile
};