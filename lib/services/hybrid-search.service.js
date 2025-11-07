// /lib/services/hybrid-search.service.js

import lunr from 'lunr';

const log = (msg) => process.stderr.write(`${msg}\n`);

// Dizionario di entità importanti per il boosting (invariato)
const IMPORTANT_ENTITIES = ['spigola', 'branzino', 'orata', 'sarago', 'serra', 'barracuda', 'calamaro', 'spinning', 'surfcasting', 'bolognese', 'eging', 'posillipo', 'napoli'];
const LOCATION_MAPPINGS = { 'posillipo': 'napoli' };

function normalizeScores(scores) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) return scores.map(() => 0.5);
    return scores.map(score => (score - min) / (max - min));
}

export function performHybridSearch(query, candidateDocs, semanticSimilarities, alpha = 0.6) {
    if (candidateDocs.length === 0) return [];

    // --- 1. KEYWORD SEARCH (LUNR) ---
    // Crea un indice Lunr al volo
    const idx = lunr(function () {
        this.ref('id'); // Usa l'indice dell'array come riferimento
        this.field('content'); // Campo su cui cercare
        
        // Aggiungi un boost per le entità importanti
        IMPORTANT_ENTITIES.forEach(entity => {
            const regex = new RegExp(`\\b${entity}\\b`, 'i');
            if (regex.test(query.toLowerCase())) {
                this.field('content', { boost: 10 });
            }
        });

        candidateDocs.forEach((doc, i) => {
            this.add({
                id: i,
                content: doc.content
            });
        });
    });

    const keywordResults = idx.search(query);
    const keywordScores = new Array(candidateDocs.length).fill(0);
    keywordResults.forEach(result => {
        keywordScores[parseInt(result.ref)] = result.score;
    });

    // --- 2. NORMALIZZAZIONE E CALCOLO IBRIDO ---
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

    log(`[Hybrid Search] 🧬 Ricerca ibrida (LUNR) completata. Top Score: ${hybridScores[0]?.similarity.toFixed(4)} (Sem: ${hybridScores[0]?._debug.semantic}, Key: ${hybridScores[0]?._debug.keyword})`);

    return hybridScores;
}