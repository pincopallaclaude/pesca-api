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

// ==========================================================
// 🔥 NUOVA FUNZIONE: Estrazione Metadati 🔥
// ==========================================================
const METADATA_KEYWORDS = {
    species: ['spigola', 'branzino', 'orata', 'sarago', 'serra', 'barracuda', 'calamaro', 'seppia', 'totano'],
    technique: ['spinning', 'surfcasting', 'bolognese', 'inglese', 'eging', 'fondo', 'light rock fishing', 'lrf'],
    location: ['molo', 'scogliera', 'spiaggia', 'porto', 'foce'],
    lure_type: ['artificiali', 'minnow', 'wtd', 'popper', 'gomme', 'siliconiche', 'jig', 'egi', 'totanare'],
    bait_type: ['vivo', 'naturale', 'granchio', 'bibi', 'americano']
};

/**
 * Estrae metadati da un testo basandosi su un dizionario di keyword.
 * @param {string} text - Il testo dello snippet.
 * @returns {object} Un oggetto contenente i metadati estratti.
 */
function extractMetadata(text) {
    const metadata = {};
    const textLower = text.toLowerCase();

    for (const [category, keywords] of Object.entries(METADATA_KEYWORDS)) {
        const foundKeywords = keywords.filter(keyword => textLower.includes(keyword));
        if (foundKeywords.length > 0) {
            // Usa un Set per garantire l'unicità
            metadata[category] = [...new Set(foundKeywords)];
        }
    }
    return metadata;
}
// ==========================================================


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

        const data = await new Promise((resolve) => {
            search.json(params, resolve);
        });
        
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
            .map(res => {
                const content = res.snippet.replace(/\[\.\.\.\]/g, '').trim();
                // 🔥 MODIFICA: Aggiungi i metadati a ogni documento
                const metadata = extractMetadata(content);
                return { content, source: res.link, metadata };
            });
        
        console.log(`[PIPELINE-SEARCH] Trovati e processati ${documents.length} snippet pertinenti.`);
        return documents;

    } catch (error) {
        console.error(`[PIPELINE-SEARCH] ❌ ERRORE durante la ricerca per "${query}":`, error.message || error);
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
            
            if (embeddings.length !== batchChunks.length) {
                console.error(`[PIPELINE-SEED] ❌ ERRORE: Disallineamento nel batch! Attesi ${batchChunks.length} embeddings, ricevuti ${embeddings.length}.`);
                continue;
            }
            
            populateIndex(batchChunks, embeddings);
            totalEmbeddingsGenerated += embeddings.length;

        } catch (error) {
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
    console.log(`[PIPELINE-MAIN] Totale snippet unici raccolti: ${uniqueChunks.length}`);

    // 🔥 LOG CRUCIALE: Mostra un'anteprima dei metadati estratti per il primo chunk
    if (uniqueChunks.length > 0 && uniqueChunks[0].metadata) {
        console.log(`[PIPELINE-METADATA] 🏷️ Esempio metadati estratti:`, uniqueChunks[0].metadata);
    }

    await seedChunks(uniqueChunks);
    saveKnowledgeBaseToFile();

    console.log('--- [DATA PIPELINE END] ---');
}

main().catch(err => {
    console.error('[PIPELINE-FATAL] ❌ Pipeline fallita con un errore critico:', err.message);
    process.exit(1);
});