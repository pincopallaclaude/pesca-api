// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// 🔥 NUOVO IMPORT: Importa la funzione di espansione
import { expandQuery } from '../utils/query-expander.js';

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

const KnowledgeBase = {
    documents: [],
    load: function() {
        try {
            if (fs.existsSync(KB_FILE_PATH)) {
                this.documents = JSON.parse(fs.readFileSync(KB_FILE_PATH, 'utf-8'));
                log(`[Vector Service] ✅ KB caricata: ${this.documents.length} documenti da ${KB_FILE_PATH}`);
            } else { 
                log(`[Vector Service] ⚠️ knowledge_base.json not found.`); 
            }
        } catch (error) { 
            log(`[Vector Service] ❌ ERROR loading KB: ${error.message}`); 
        }
    },
    save: function() {
        if (this.documents.length === 0) {
            log('[VectorService] ⚠️ Knowledge base is empty. Nothing to save.');
            return;
        }
        try {
            const data = JSON.stringify(this.documents, null, 2);
            fs.writeFileSync(KB_FILE_PATH, data, 'utf-8');
            log(`[VectorService] Knowledge base successfully saved to ${KB_FILE_PATH}`);
        } catch (error) {
            log(`[VectorService] ❌ ERROR saving knowledge base to file: ${error.message}`);
        }
    }
};

KnowledgeBase.load();

function populateIndex(docs, embeddings) {
    KnowledgeBase.documents = docs.map((doc, index) => ({
        ...doc,
        embedding: embeddings[index],
    }));
    log(`[VectorService] Populated in-memory JS array with ${KnowledgeBase.documents.length} documents.`);
}

function saveKnowledgeBaseToFile() {
    KnowledgeBase.save();
}

async function queryKnowledgeBase(query, topK = 5) {
    try {
        log(`[Vector Service] 🔍 Query originale ricevuta: "${query}"`);
        
        if (!KnowledgeBase.documents || KnowledgeBase.documents.length === 0) {
            log('[Vector Service] ⚠️ Knowledge Base is empty during query.');
            return [];
        }

        // ==========================================================
        // 🔥 NUOVA LOGICA: QUERY EXPANSION 🔥
        // ==========================================================
        const expandedQuery = expandQuery(query);
        // Se la query è cambiata, loggala
        if (expandedQuery !== query) {
            log(`[Vector Service] ➡️  Query espansa in: "${expandedQuery}"`);
        }
        // ==========================================================

        const queryResult = await embeddingModel.embedContent({ 
            // Usa la query espansa per generare l'embedding
            content: { parts: [{ text: expandedQuery }] }
        });
        const queryEmbedding = queryResult.embedding.values;
        log(`[Vector Service] ✅ Embedding generato per query espansa (dim: ${queryEmbedding.length})`);

        const cosineSimilarity = (vecA, vecB) => {
            if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length !== vecB.length) return 0;
            let dotProduct = 0, magnitudeA = 0, magnitudeB = 0;
            for (let i = 0; i < vecA.length; i++) {
                dotProduct += vecA[i] * vecB[i];
                magnitudeA += vecA[i] * vecA[i];
                magnitudeB += vecB[i] * vecB[i];
            }
            magnitudeA = Math.sqrt(magnitudeA);
            magnitudeB = Math.sqrt(magnitudeB);
            if (magnitudeA === 0 || magnitudeB === 0) return 0;
            const similarity = dotProduct / (magnitudeA * magnitudeB);
            return isNaN(similarity) ? 0 : similarity;
        };

        const similarities = KnowledgeBase.documents.map(doc => ({
            text: doc.content, 
            similarity: cosineSimilarity(queryEmbedding, doc.embedding)
        }));

        similarities.sort((a, b) => b.similarity - a.similarity);

        log(`[Vector Service] 📊 Top 5 similarità (raw):`);
        similarities.slice(0, 5).forEach((s, i) => {
            log(`  ${i+1}. Score: ${s.similarity.toFixed(4)} | Text: ${(s.text || '').substring(0, 80)}...`);
        });

        const maxSimilarity = similarities[0]?.similarity || 0;
        let threshold;

        if (maxSimilarity >= 0.7) {
            threshold = 0.6;
        } else if (maxSimilarity >= 0.55) {
            threshold = 0.45;
        } else {
            threshold = 0.35;
        }
        
        log(`[Vector Service] 🎯 Threshold Adattiva impostata a: ${threshold} (basata su max similarità di ${maxSimilarity.toFixed(4)})`);
        
        const results = similarities
            .filter(item => item.similarity >= threshold)
            .slice(0, topK)
            .map(item => ({ text: item.text, similarity: item.similarity }));

        log(`[Vector Service] ✅ Restituiti ${results.length} risultati (soglia: ${threshold}, topK: ${topK})`);
        
        if (results.length === 0 && similarities.length > 0) {
            log(`[Vector Service] ⚠️ Nessun risultato ha superato la soglia. (Max similarity: ${similarities[0]?.similarity.toFixed(4)})`);
        }

        return results;
        
    } catch (error) {
        log(`[Vector Service] ❌ Errore durante la query: ${error.message}`);
        return [];
    }
}

export {
    embeddingModel,
    populateIndex, 
    queryKnowledgeBase,
    saveKnowledgeBaseToFile 
};