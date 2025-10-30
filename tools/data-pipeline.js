// tools/data-pipeline.js

import 'dotenv/config';
import { fileURLToPath } from 'url';
import { GoogleSearch } from 'google-search-results-nodejs';
import { embeddingModel, populateIndex, saveKnowledgeBaseToFile } from '../lib/services/vector.service.js';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const search = new GoogleSearch(process.env.SERPAPI_API_KEY);
const BATCH_SIZE = 100;

async function fetchSearchResults(query) {
    console.log(`[PIPELINE-SEARCH] Eseguo ricerca per: "${query}"`);
    try {
        const params = {
            engine: "google",
            q: query,
            location: "Italy",
            gl: "it",
            hl: "it",
        };

        const data = await new Promise((resolve, reject) => {
            search.json(params, resolve);
        });

        // 🔥 LOG CRUCIALE: Logga le ricerche residue di SerpApi
        const searchesRemaining = data.search_information?.total_searches_left;
        if (searchesRemaining !== undefined) {
            console.log(`[PIPELINE-MONITOR] 📈 Ricerche SerpApi residue questo mese: ${searchesRemaining}`);
        }

        const organicResults = data["organic_results"];
        if (!organicResults || organicResults.length === 0) {
            console.warn(`[PIPELINE-SEARCH] Nessun risultato organico per "${query}".`);
            return [];
        }

        const documents = organicResults
            .filter(res => res.snippet)
            .slice(0, 5)
            .map(res => ({
                content: res.snippet.replace(/\[\.\.\.\]/g, '').trim(),
                source: res.link,
            }));
        
        console.log(`[PIPELINE-SEARCH] Trovati ${documents.length} snippet pertinenti.`);
        return documents;

    } catch (error) {
        // 🔥 LOG CRUCIALE: Logga l'errore specifico dell'API
        console.error(`[PIPELINE-SEARCH] ❌ ERRORE durante la ricerca per "${query}":`, error.message || error);
        // Lancia l'errore per bloccare la pipeline ed evitare di generare una KB incompleta
        throw error;
    }
}

async function seedChunks(chunks) {
    if (chunks.length === 0) {
        console.warn('[PIPELINE-SEED] Nessun chunk da processare. La KB non verrà aggiornata.');
        return;
    }

    let totalEmbeddingsGenerated = 0;
    
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batchChunks = chunks.slice(i, i + BATCH_SIZE);
        try {
            console.log(`[PIPELINE-SEED] Genero embeddings per il batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}...`);
            
            const contents = batchChunks.map(chunk => ({ content: { parts: [{ text: chunk.content }] } }));
            const result = await embeddingModel.batchEmbedContents({ requests: contents });
            const embeddings = result.embeddings.map(e => e.values);
            
            // 🔥 LOG CRUCIALE: Verifica di coerenza
            if (embeddings.length !== batchChunks.length) {
                console.error(`[PIPELINE-SEED] ❌ ERRORE: Disallineamento nel batch! Attesi ${batchChunks.length} embeddings, ricevuti ${embeddings.length}.`);
                continue; // Salta questo batch corrotto
            }
            
            populateIndex(batchChunks, embeddings);
            totalEmbeddingsGenerated += embeddings.length;

        } catch (error) {
            // 🔥 LOG CRUCIALE: Errore specifico del batch
            console.error(`[PIPELINE-SEED] ❌ ERRORE durante la generazione embeddings del batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error.message);
        }
    }

    console.log(`[PIPELINE-SEED] ✅ Generati e processati con successo ${totalEmbeddingsGenerated} embeddings.`);
}

async function main() {
    console.log('--- [DATA PIPELINE START] ---');
    
    const sourcesPath = path.resolve(__dirname, '..', 'sources.json');
    if (!fs.existsSync(sourcesPath)) {
        throw new Error(`File sources.json non trovato a: ${sourcesPath}`);
    }
    const { search_queries: SEARCH_QUERIES } = JSON.parse(fs.readFileSync(sourcesPath, 'utf-8'));
    console.log(`[PIPELINE-MAIN] Caricate ${SEARCH_QUERIES.length} query di ricerca.`);

    let allChunks = [];
    for (const query of SEARCH_QUERIES) {
        const searchResults = await fetchSearchResults(query);
        allChunks.push(...searchResults);
    }

    const uniqueChunks = Array.from(new Map(allChunks.map(item => [item.content, item])).values());
    // 🔥 LOG CRUCIALE: Statistiche finali prima del seeding
    console.log(`[PIPELINE-MAIN] Totale snippet unici raccolti: ${uniqueChunks.length}`);

    await seedChunks(uniqueChunks);
    saveKnowledgeBaseToFile();

    console.log('--- [DATA PIPELINE END] ---');
}

main().catch(err => {
    console.error('[PIPELINE-FATAL] ❌ Pipeline fallita con un errore critico:', err.message);
    process.exit(1); // Esci con un codice di errore per far fallire il workflow
});