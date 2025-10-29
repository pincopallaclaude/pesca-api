import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import HNSW from 'hnswlib-node'; // Importa il pacchetto
const { HierarchicalNSW } = HNSW; // Estrai la classe

const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

// Inizializzazione del client Gemini per l'embedding
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

// Esporta le variabili di stato per renderle ispezionabili dall'esterno
export let knowledgeBase = [];
export let index = null; // Variabile per l'indice HNSW

/**
 * Carica la Knowledge Base dal file JSON pre-embedded e costruisce l'indice HNSW in memoria.
 * Funzione rinominata da 'loadKnowledgeBaseFromFile' a 'initKnowledgeBase'.
 * @returns {Promise<void>}
 */
export async function initKnowledgeBase() {
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
        // La distanza Cosine è un'ottima scelta per la similarità vettoriale
        index = new HierarchicalNSW('cosine', dimensions);
        // Inizializza l'indice con il numero totale di documenti
        index.initIndex(knowledgeBase.length);
        
        knowledgeBase.forEach((doc, i) => {
            if (doc.embedding && doc.embedding.length === dimensions) {
                // Aggiunge il vettore (embedding) all'indice, mappandolo all'indice array (i)
                index.addPoint(doc.embedding, i);
            }
        });
        log(`[Vector Service] 🚀 Indice HNSW costruito con successo.`);
        // ------------------------------------

    } catch (error) {
        // Aggiornato il messaggio di log
        log(`[VectorService] ❌ ERROR initializing knowledge base: ${error.message}`);
    }
}

/**
 * Esegue una query sul Vector DB, trova i documenti più rilevanti e li restituisce.
 * @param {string} queryText - Il testo della query.
 * @param {number} nResults - Il numero massimo di risultati da restituire.
 * @returns {Promise<Array<{text: string, source: string, similarity: number}>>}
 */
export async function queryKnowledgeBase(queryText, nResults = 5) {
    // Controllo se l'indice è pronto prima di procedere
    if (!queryText || knowledgeBase.length === 0 || !index) {
        log(`[VectorService] Query annullata (KB vuota o indice non pronto).`);
        return [];
    }

    try {
        // 1. Crea l'embedding del testo della query
        const queryResult = await embeddingModel.embedContent({ content: { parts: [{ text: queryText }] } });
        const queryVector = queryResult.embedding.values;

        // 2. --- RICERCA ULTRA-VELOCE TRAMITE INDICE ---
        // Cerca i k-nearest neighbors (kNN) nell'indice HNSW
        const { neighbors, distances } = index.searchKnn(queryVector, nResults);
        // ------------------------------------------

        // 3. Mappa gli indici trovati (neighbors) ai documenti originali
        const results = neighbors.map((neighborIndex, i) => ({
            text: knowledgeBase[neighborIndex].content,
            source: knowledgeBase[neighborIndex].source,
            // Per la distanza Coseno (che va da 0 a 2), 1 - distanza è una buona metrica di similarità
            similarity: 1 - distances[i] 
        }));

        log(`[VectorService] Trovati ${results.length} documenti via HNSW.`);
        return results.filter(r => r.similarity > 0.5); // Filtra per una soglia minima (da tarare)

    } catch (error) {
        log(`[VectorService] ❌ ERROR querying index: ${error.message}`);
        return [];
    }
}
