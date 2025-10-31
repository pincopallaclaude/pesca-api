// /lib/services/hybrid-search.service.js

import TfIdfSearch from 'tf-idf-search';

const log = (msg) => process.stderr.write(`${msg}\n`);

// Dizionario di entità importanti per il boosting
const IMPORTANT_ENTITIES = [
    'spigola', 'branzino', 'orata', 'sarago', 'serra', 'barracuda', 'calamaro', 
    'spinning', 'surfcasting', 'bolognese', 'eging', 'posillipo', 'napoli'
];
// Regole di mappatura per località
const LOCATION_MAPPINGS = {
    'posillipo': 'napoli'
};

/**
 * Crea una query "potenziata" per la ricerca keyword, ripetendo le entità importanti.
 * Applica anche le mappature delle località.
 * @param {string} originalQuery - La query di ricerca originale.
 * @returns {string} La query potenziata per il TF-IDF.
 */
function createBoostedQuery(originalQuery) {
    const queryLower = originalQuery.toLowerCase();
    const foundEntities = new Set();

    // 1. Trova le entità presenti nella query
    IMPORTANT_ENTITIES.forEach(entity => {
        const regex = new RegExp(`\\b${entity}\\b`, 'i');
        if (regex.test(queryLower)) {
            foundEntities.add(entity);
        }
    });

    // 2. Applica le regole di mappatura (Posillipo -> Napoli)
    if (foundEntities.has('posillipo')) {
        foundEntities.add(LOCATION_MAPPINGS['posillipo']);
    }

    // 3. Se non ci sono entità, restituisci la query originale
    if (foundEntities.size === 0) {
        return originalQuery;
    }

    // 4. Costruisci la parte "boostata" della query
    const boostedPart = [...foundEntities].map(entity => `${entity} `.repeat(3)).join('');
    const boostedQuery = `${originalQuery} ${boostedPart}`;
    
    log(`[Light Re-Ranking] 🚀 Query potenziata per keyword search: trovate entità [${[...foundEntities].join(', ')}]`);
    return boostedQuery;
}


function normalizeScores(scores) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) return scores.map(() => 0.5);
    return scores.map(score => (score - min) / (max - min));
}

export function performHybridSearch(query, candidateDocs, semanticSimilarities, alpha = 0.6) {
    if (candidateDocs.length === 0) return [];

    // --- 1. KEYWORD SEARCH (TF-IDF) con QUERY POTENZIATA ---
    const boostedQuery = createBoostedQuery(query); // 🔥 USA LA QUERY POTENZIATA
    const search = new TfIdfSearch();
    candidateDocs.forEach((doc, index) => {
        search.addDocumentToIndex(index.toString(), doc.content.toLowerCase());
    });

    const keywordResults = search.search(boostedQuery.toLowerCase());
    const keywordScores = new Array(candidateDocs.length).fill(0);
    keywordResults.forEach(result => {
        keywordScores[parseInt(result.key)] = result.score;
    });

    // --- 2. NORMALIZZAZIONE E CALCOLO IBRIDO (invariato) ---
    const normalizedSemanticScores = normalizeScores(semanticSimilarities.map(s => s.similarity));
    const normalizedKeywordScores = normalizeScores(keywordScores);

    const hybridScores = candidateDocs.map((doc, i) => {
        const semanticScore = normalizedSemanticScores[i];
        const keywordScore = normalizedKeywordScores[i];
        const hybridScore = (alpha * semanticScore) + ((1 - alpha) * keywordScore);

        return {
            ...semanticSimilarities[i],
            similarity: hybridScore,
            _debug: {
                semantic: semanticScore.toFixed(4),
                keyword: keywordScore.toFixed(4),
                original: semanticSimilarities[i].similarity.toFixed(4)
            }
        };
    });

    // --- 3. ORDINAMENTO FINALE ---
    hybridScores.sort((a, b) => b.similarity - a.similarity);

    log(`[Hybrid Search] 🧬 Ricerca ibrida completata. Esempio Top Score: ${hybridScores[0]?.similarity.toFixed(4)} (Sem: ${hybridScores[0]?._debug.semantic}, Key: ${hybridScores[0]?._debug.keyword})`);

    return hybridScores;
}