// /lib/services/vector.service.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

// --- Gestione dei percorsi ESM (Sostituzione di __dirname) ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// -----------------------------------------------------------

// KB_FILE_PATH ora usa il nuovo __dirname
const KB_FILE_PATH = path.join(__dirname, '..', '..', 'knowledge_base.json');

// Struttura dati in-memory: array di oggetti che contiene documento e vettore.
let knowledgeBase = [];

/**
 * Loads the knowledge base from a JSON file into memory on server startup.
 */
function loadKnowledgeBaseFromFile() {
    try {
        if (fs.existsSync(KB_FILE_PATH)) {
            const data = fs.readFileSync(KB_FILE_PATH, 'utf-8');
            // Il file è già un array di oggetti pronti all'uso.
            knowledgeBase = JSON.parse(data);
            log(`[VectorService] Knowledge base loaded. Total documents: ${knowledgeBase.length}`);
        } else {
             log(`[VectorService] ⚠️ knowledge_base.json not found.`);
        }
    } catch (error) {
        log(`[VectorService] ❌ ERROR loading knowledge base: ${error.message}`);
        // Reset knowledgeBase on error
        knowledgeBase = []; 
    }
}

// Funzione di similarità in puro JS (mantenuta, ma non usata da queryKnowledgeBase)
const cosineSimilarity = (vecA, vecB) => {
    if (!vecA || !vecB) return 0;
    const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    return dotProduct / (magnitudeA * magnitudeB);
};

/**
 * Queries the in-memory JS array (ora uno stub).
 * La logica di embedding e ricerca è disabilitata e restituisce sempre un array vuoto.
 * @param {string} queryText - The text to search for.
 * @param {number} nResults - The number of results to return.
 * @returns {Promise<object[]>} An array of the most relevant knowledge documents (always empty).
 */
async function queryKnowledgeBase(queryText, nResults = 2) {
    log(`[VectorService] Ricerca vettoriale disabilitata per debug.`);
    return [];
}

export {
    queryKnowledgeBase,
    loadKnowledgeBaseFromFile
};
