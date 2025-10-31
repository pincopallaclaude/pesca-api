// /lib/services/vector.service.js

import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { expandQuery } from '../utils/query-expander.js';
import { performHybridSearch } from './hybrid-search.service.js';

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
    documents: [], // Array di oggetti: { content, name, embedding, metadata: {} }

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
 * @param {object} [filters={}] - Optional metadata filters (e.g., { category: 'manuale', location: 'Posillipo' }).
 * @returns {Promise<object[]>} An array of the most relevant documents ({text: string, similarity: number}).
 */
async function queryKnowledgeBase(query, topK = 5, filters = {}) {
    try {
        log(`[Vector Service] 🔍 Query originale ricevuta: "${query}"`);
        
        if (!KnowledgeBase.documents || KnowledgeBase.documents.length === 0) {
            log('[Vector Service] ⚠️ Knowledge Base is empty during query.');
            return [];
        }

        // ==========================================================
        // 🔥 LOGICA 1: PRE-FILTERING SUI METADATI 🔥
        // Filtra KnowledgeBase.documents in base ai metadati
        // ==========================================================
        let candidateDocs = KnowledgeBase.documents;
        // Identifica solo i filtri con un valore (non null/undefined/stringa vuota)
        const activeFilters = Object.keys(filters).filter(key => filters[key]);

        if (activeFilters.length > 0) {
            log(`[Vector Service] 🚦 Filtri attivi: ${activeFilters.join(', ')}`);
            candidateDocs = candidateDocs.filter(doc => {
                return activeFilters.every(key => {
                    const filterValue = filters[key];
                    const docValue = doc.metadata?.[key];
                    
                    // Se il documento non ha il metadata richiesto o il valore non corrisponde, viene scartato.
                    // Assumiamo che i valori dei metadati nel doc siano stringhe o array di stringhe.
                    if (Array.isArray(docValue)) {
                        return docValue.includes(filterValue);
                    }
                    
                    return docValue === filterValue;
                });
            });
            log(`[Vector Service] ➡️  Documenti candidati dopo filtro: ${candidateDocs.length}/${KnowledgeBase.documents.length}`);
            
            if (candidateDocs.length === 0) {
                log('[Vector Service] ⚠️ Nessun documento corrisponde ai filtri forniti.');
                // L'array vuoto è il risultato atteso se i filtri non producono corrispondenze.
                return []; 
            }
        }
        // ==========================================================

        // ==========================================================
        // 🔥 LOGICA 2: QUERY EXPANSION 🔥
        // Espande la query per migliorare la ricerca vettoriale
        // ==========================================================
        const expandedQuery = expandQuery(query);
        if (expandedQuery !== query) {
            log(`[Vector Service] ➡️  Query espansa in: "${expandedQuery}"`);
        }
        // ==========================================================

        // 3. Genera embedding per la query espansa
        const queryResult = await embeddingModel.embedContent({ 
            content: { parts: [{ text: expandedQuery }] }
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

        // 4. Calcola similarità semantica sui documenti candidati
        const similarities = candidateDocs.map(doc => ({
            text: doc.content, 
            metadata: doc.metadata, // Includi i metadati nel risultato
            similarity: cosineSimilarity(queryEmbedding, doc.embedding) // Questo è il punteggio SEMANTICO
        }));

        // ==========================================================
        // 🔥 NUOVA LOGICA: HYBRID SEARCH 🔥
        // Combina i punteggi semantici con quelli keyword (TF-IDF)
        // ==========================================================
        const hybridResults = performHybridSearch(query, candidateDocs, similarities);

        log(`[Vector Service] 📊 Top 5 risultati IBRIDI:`);
        hybridResults.slice(0, 5).forEach((s, i) => {
            // Aggiungi controlli per assicurarsi che i valori di debug siano numeri prima di formattarli
            const semScore = typeof s._debug?.semantic === 'number' ? s._debug.semantic.toFixed(4) : s._debug?.semantic || 'N/A';
            const keyScore = typeof s._debug?.keyword === 'number' ? s._debug.keyword.toFixed(4) : s._debug?.keyword || 'N/A';
            log(`  ${i+1}. Score: ${s.similarity.toFixed(4)} | Sem: ${semScore}, Key: ${keyScore} | Text: ${(s.text || '').substring(0, 60)}...`);
        });

        // La threshold adattiva non è più necessaria perché il punteggio ibrido è già normalizzato
        // e combina rilevanza semantica e testuale. Prendiamo semplicemente i top K.
        const results = hybridResults.slice(0, topK);
        
        log(`[Vector Service] ✅ Restituiti ${results.length} risultati ibridi (topK: ${topK})`);
        
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
