// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HierarchicalNSW } from 'hnswlib-node'; // Importa l'indice

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

let knowledgeBase = [];
let index; // Variabile per l'indice HNSW

function loadKnowledgeBaseFromFile() {
    try {
        if (!fs.existsSync(KB_FILE_PATH)) {
            log(`[VectorService] ⚠️ knowledge_base.json not found.`);
            return;
        }

        const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
        knowledgeBase = JSON.parse(data);

        log(`[Vector Service] ✅ KB caricata: ${knowledgeBase.length} documenti`);
        if (knowledgeBase.length === 0) {
            log('[Vector Service] ⚠️ ATTENZIONE: Knowledge Base VUOTA!');
            return;
        }

        // --- COSTRUZIONE DELL'INDICE HNSW ---
        const dimensions = knowledgeBase[0].embedding.length;
        index = new HierarchicalNSW('cosine', dimensions);
        index.initIndex(knowledgeBase.length);
        
        knowledgeBase.forEach((doc, i) => {
            if (doc.embedding && doc.embedding.length === dimensions) {
                index.addPoint(doc.embedding, i);
            }
        });
        log(`[Vector Service] 🚀 Indice HNSW costruito con successo.`);
        // ------------------------------------

    } catch (error) {
        log(`[VectorService] ❌ ERROR loading knowledge base: ${error.message}`);
    }
}

async function queryKnowledgeBase(queryText, nResults = 5) {
    if (!queryText || knowledgeBase.length === 0 || !index) {
        log(`[VectorService] Query annullata (KB vuota o indice non pronto).`);
        return [];
    }

    try {
        const queryResult = await embeddingModel.embedContent({ content: { parts: [{ text: queryText }] } });
        const queryVector = queryResult.embedding.values;

        // --- RICERCA ULTRA-VELOCE TRAMITE INDICE ---
        const { neighbors, distances } = index.searchKnn(queryVector, nResults);
        // ------------------------------------------

        const results = neighbors.map((neighborIndex, i) => ({
            text: knowledgeBase[neighborIndex].content,
            source: knowledgeBase[neighborIndex].source,
            similarity: 1 - distances[i] // HNSW restituisce la distanza, noi vogliamo la similarità
        }));

        log(`[VectorService] Trovati ${results.length} documenti via HNSW.`);
        return results.filter(r => r.similarity > 0.5); // Filtra per una soglia minima

    } catch (error) {
        log(`[VectorService] ❌ ERROR querying index: ${error.message}`);
        return [];
    }
}

// Esporta le funzioni necessarie
export { loadKnowledgeBaseFromFile, queryKnowledgeBase };