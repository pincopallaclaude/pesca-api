// tools/data-pipeline.js

require('dotenv').config();
console.log('[DEBUG] Variabili d\'ambiente caricate:', process.env);
const SerpApi = require('google-search-results-nodejs');
const search = new SerpApi.GoogleSearch();
const { embeddingModel, populateIndex, saveKnowledgeBaseToFile } = require('../lib/services/vector.service');
const fs = require('fs');
const path = require('path');

const CHUNK_SIZE = 200; // Riduciamo leggermente per i riassunti

/**
 * PHASE 1: Fetch organic search results from SerpApi.
 * @param {string} query - The search query.
 * @returns {Promise<Array<{content: string, source: string}>>} A list of documents with content and source URL.
 */
async function fetchSearchResults(query) {
    console.log(`[PIPELINE-SEARCH] Executing search for: "${query}"`);
    try {
        const params = {
            api_key: process.env.SERPAPI_API_KEY,
            engine: "google",
            q: query,
            location: "Italy",
            gl: "it",
            hl: "it",
        };

        // Usa una Promise per gestire la callback della libreria
        const results = await new Promise((resolve, reject) => {
            search.json(params, (data) => {
                resolve(data);
            });
        });

        const organicResults = results["organic_results"];
        if (!organicResults || organicResults.length === 0) {
            console.log(`[PIPELINE-SEARCH] No organic results found for "${query}".`);
            return [];
        }

        // Estraiamo i riassunti (snippet) e i link
        const documents = organicResults
            .filter(res => res.snippet) // Prendi solo i risultati che hanno uno snippet
            .slice(0, 5) // Prendi i primi 5 risultati
            .map(res => ({
                content: res.snippet,
                source: res.link,
            }));
        
        console.log(`[PIPELINE-SEARCH] Found ${documents.length} relevant snippets for "${query}".`);
        return documents;

    } catch (error) {
        console.error(`[PIPELINE-SEARCH] ERROR fetching results for "${query}":`, error.message);
        return [];
    }
}


/**
 * PHASE 2: (Semplificata) I riassunti sono già dei "chunk" naturali.
 * Qui potremmo aggiungere logica di pulizia se necessario.
 * @param {Array<{content: string, source: string}>} documents - The documents from the search results.
 * @returns {Array<{content: string, source: string}>} The cleaned/validated chunks.
 */
function processSnippets(documents) {
    // Per ora, ci limitiamo a restituire i documenti così come sono.
    // In futuro, potremmo pulire "[...]" o altre impurità.
    const chunks = documents.map(doc => ({
        ...doc,
        content: doc.content.replace(/\[\.\.\.\]/g, '').trim(), // Esempio di pulizia
    }));
    console.log(`[PIPELINE-CHUNK] Processed ${chunks.length} snippets.`);
    return chunks;
}


/**
 * PHASE 3: Generate embeddings and seed the vector database.
 * (Questa funzione rimane identica a prima)
 */
async function seedChunks(chunks) {
    if (chunks.length === 0) {
        console.log('[PIPELINE-SEED] No chunks to seed. Exiting.');
        return;
    }
    try {
        console.log(`[PIPELINE-SEED] Generating embeddings for ${chunks.length} chunks...`);
        const contents = chunks.map(chunk => ({ content: { parts: [{ text: chunk.content }] } }));
        const result = await embeddingModel.batchEmbedContents({ requests: contents });
        const embeddings = result.embeddings.map(e => e.values);
        if (embeddings.length !== chunks.length) {
            throw new Error('Mismatch between chunks and embeddings.');
        }
        console.log(`[PIPELINE-SEED] Successfully generated ${embeddings.length} embeddings.`);
        populateIndex(chunks, embeddings);
    } catch (error) {
        console.error('[PIPELINE-SEED] ERROR during embedding or seeding:', error.message);
    }
}


/**
 * Main orchestration function.
 */
async function main() {
    console.log('--- [DATA PIPELINE START] ---');
    
    const sourcesPath = path.join(__dirname, '..', 'sources.json');
    if (!fs.existsSync(sourcesPath)) {
        console.error(`[PIPELINE-ERROR] Sources file not found at: ${sourcesPath}`);
        return;
    }
    const sourcesFile = fs.readFileSync(sourcesPath, 'utf-8');
    const { search_queries: SEARCH_QUERIES } = JSON.parse(sourcesFile);
    console.log(`[PIPELINE-MAIN] Loaded ${SEARCH_QUERIES.length} search queries from sources.json.`);

    let allChunks = [];

    for (const query of SEARCH_QUERIES) {
        const searchResults = await fetchSearchResults(query);
        if (searchResults.length > 0) {
            const processedChunks = processSnippets(searchResults);
            allChunks = allChunks.concat(processedChunks);
        }
    }

    // Rimuovi eventuali duplicati basati sul contenuto
    const uniqueChunks = Array.from(new Map(allChunks.map(item => [item.content, item])).values());
    console.log(`[PIPELINE-MAIN] Total unique chunks to be seeded: ${uniqueChunks.length}`);

    await seedChunks(uniqueChunks);
    saveKnowledgeBaseToFile();

    console.log('--- [DATA PIPELINE END] ---');
}


console.log('[DEBUG] Script execution reached the final part. Attempting to run main().');

// Questo blocco esegue la funzione main() solo quando lo script
// viene lanciato direttamente da Node.js.
if (require.main === module) {
    main().catch(err => {
        console.error('[PIPELINE-FATAL] An unexpected error occurred:', err);
        process.exit(1);
    });
}



module.exports = { runDataPipeline: main };