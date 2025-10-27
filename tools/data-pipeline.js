// tools/data-pipeline.js

import 'dotenv/config';
import { fileURLToPath } from 'url'; // Import necessario per gestire import.meta.url
console.log('[DEBUG] Variabili d\'ambiente caricate (dopo import config):', process.env.NODE_ENV);
import SerpApi from 'google-search-results-nodejs'; // La libreria SerpApi potrebbe aver bisogno di una classe specifica, assumiamo sia l'export di default per la classe.
import { GoogleSearch } from 'google-search-results-nodejs'; // Import specifico per la classe
import { embeddingModel, populateIndex, saveKnowledgeBaseToFile } from '../lib/services/vector.service.js';
import fs from 'fs';
import path from 'path';

// DEFINIZIONE ESM: Crea l'equivalente di __filename e __dirname per i moduli ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// La libreria google-search-results-nodejs in ESM usa il costruttore GoogleSearch
const search = new GoogleSearch(); 
const CHUNK_SIZE = 200; // Riduciamo leggermente per i riassunti
const BATCH_SIZE = 100; // Limite FISSO dell'API per batchEmbedContents (massimo 100 richieste)

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
 * Implementa il batching per rispettare il limite API di 100 richieste per chiamata.
 */
async function seedChunks(chunks) {
    if (chunks.length === 0) {
        console.log('[PIPELINE-SEED] No chunks to seed. Exiting.');
        return;
    }

    let totalEmbeddings = 0;
    
    // Ciclo per suddividere i chunks in lotti da BATCH_SIZE (100)
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        
        try {
            console.log(`[PIPELINE-SEED] Generating embeddings for batch ${Math.floor(i / BATCH_SIZE) + 1} (${batchChunks.length} chunks)...`);
            
            // Crea il formato richiesto dall'API per il batch
            const contents = batchChunks.map(chunk => ({ content: { parts: [{ text: chunk.content }] } }));
            
            // Chiama l'API per il batch corrente
            const result = await embeddingModel.batchEmbedContents({ requests: contents });
            const embeddings = result.embeddings.map(e => e.values);
            
            if (embeddings.length !== batchChunks.length) {
                throw new Error(`Mismatch in batch ${i}: expected ${batchChunks.length}, got ${embeddings.length}.`);
            }
            
            // Popola l'indice con il batch corrente di chunks e embeddings
            populateIndex(batchChunks, embeddings);
            totalEmbeddings += embeddings.length;

        } catch (error) {
            // L'errore in un batch non blocca i batch successivi
            console.error(`[PIPELINE-SEED] ERROR during embedding or seeding of batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }
    }

    if (totalEmbeddings > 0) {
        console.log(`[PIPELINE-SEED] Successfully generated and seeded ${totalEmbeddings} total embeddings.`);
    } else {
        console.error('[PIPELINE-SEED] Failed to generate any embeddings. Knowledge base remains empty.');
    }
}


/**
 * Main orchestration function.
 */
async function main() {
    console.log('--- [DATA PIPELINE START] ---');
    
    // CORREZIONE APPLICATA: path.resolve() usa il percorso assoluto da __dirname, 
    // risolvendo il problema del path malformato.
    const sourcesPath = path.resolve(__dirname, '..', 'sources.json');
    
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


// Punto di ingresso ESM per l'esecuzione diretta
// La logica qui è stata mantenuta identica, usando __filename che ora è definito
if (process.argv[1] && process.argv[1].endsWith('data-pipeline.js')) {
    console.log('[DEBUG] Script execution reached the final part. Attempting to run main().');
    main().catch(err => {
        console.error('[PIPELINE-FATAL] An unexpected error occurred:', err);
        process.exit(1);
    });
}


export { main as runDataPipeline };
