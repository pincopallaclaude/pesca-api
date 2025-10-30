// /lib/services/vector.service.js


import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Funzione di logging unificata
const log = (msg) => process.stderr.write(`${msg}\n`);

// --- Gestione dei percorsi ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ---------------------------------

const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

// Inizializza Google AI per gli embeddings
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// =========================================================================
// Oggetto KnowledgeBase per incapsulare dati e logica di I/O (carica la KB)
// =========================================================================
const KnowledgeBase = {
    documents: [], // Array di oggetti: { content, name, embedding }

    /**
     * Loads the knowledge base from a JSON file into memory.
     */
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
    
    /**
     * Saves the current in-memory knowledge base to a JSON file.
     */
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

// 🔥 ESECUZIONE IMMEDIATA: Carica la KB non appena il modulo è importato
KnowledgeBase.load();


/**
 * Funzione per popolare la base di conoscenza in-memory (usata dal rebuild script).
 * @param {object[]} docs - Array di oggetti documento ({ content: string, name: string, ... })
 * @param {number[][]} embeddings - Array di vettori (embeddings)
 */
function populateIndex(docs, embeddings) {
    // Combina i documenti con i loro vettori nel nuovo array KnowledgeBase.documents
    KnowledgeBase.documents = docs.map((doc, index) => ({
        ...doc,
        embedding: embeddings[index],
    }));
    
    log(`[VectorService] Populated in-memory JS array with ${KnowledgeBase.documents.length} documents.`);
}

/**
 * Funzione alias per la persistenza su disco (usata dal rebuild script).
 */
function saveKnowledgeBaseToFile() {
    KnowledgeBase.save();
}


/**
 * Queries the in-memory JS array using la similarità del coseno (simulazione RAG).
 * @param {string} query - The text to search for.
 * @param {number} topK - The number of results to return.
 * @returns {Promise<object[]>} An array of the most relevant documents ({text: string, similarity: number}).
 */
async function queryKnowledgeBase(query, topK = 5) {
    try {
        log(`[Vector Service] 🔍 Query ricevuta: "${query}"`);
        
        if (!KnowledgeBase.documents || KnowledgeBase.documents.length === 0) {
            log('[Vector Service] ⚠️ Knowledge Base is empty during query.');
            return [];
        }

        // 1. Genera embedding per la query
        const queryResult = await embeddingModel.embedContent({ 
            content: { parts: [{ text: query }] }
        });
        const queryEmbedding = queryResult.embedding.values;
        log(`[Vector Service] ✅ Embedding generato per query (dim: ${queryEmbedding.length})`);

        // Funzione di calcolo similarità
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

        // 2. Calcola similarità usando KnowledgeBase.documents
        const similarities = KnowledgeBase.documents.map(doc => ({
            text: doc.content, 
            similarity: cosineSimilarity(queryEmbedding, doc.embedding)
        }));

        // 3. Ordina per similarità decrescente
        similarities.sort((a, b) => b.similarity - a.similarity);

        // 🔥 THRESHOLD: 0.4
        const threshold = 0.4;
        
        // 🔥 LOG DETTAGLIATO DELLE TOP 5 SIMILARITÀ
        log(`[Vector Service] 📊 Top 5 similarità:`);
        similarities.slice(0, 5).forEach((s, i) => {
            log(`  ${i+1}. Score: ${s.similarity.toFixed(4)} | Text: ${(s.text || '').substring(0, 80)}...`);
        });

        // 4. Filtra per soglia e limita i risultati
        const results = similarities
            .filter(item => item.similarity >= threshold)
            .slice(0, topK)
            // Restituisce l'oggetto completo, con testo e similarità
            .map(item => ({ text: item.text, similarity: item.similarity }));

        log(`[Vector Service] ✅ Risultati con threshold >= ${threshold}: ${results.length}`);
        
        if (results.length === 0 && similarities.length > 0) {
            log(`[Vector Service] ⚠️ Nessun risultato! Max similarity era: ${similarities[0]?.similarity.toFixed(4)}`);
        }

        return results;
        
    } catch (error) {
        log(`[Vector Service] ❌ Errore query: ${error.message}`);
        return [];
    }
}

export {
    embeddingModel,
    populateIndex, 
    queryKnowledgeBase,
    saveKnowledgeBaseToFile 
};
