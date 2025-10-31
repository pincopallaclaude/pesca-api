// /lib/services/hybrid-search.service.js

import natural from 'natural';

const log = (msg) => process.stderr.write(`${msg}\n`);
const { TfIdf } = natural;

/**
 * Normalizza un punteggio in un range 0-1.
 * @param {number[]} scores - Un array di punteggi.
 * @returns {number[]} L'array di punteggi normalizzati.
 */
function normalizeScores(scores) {
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    if (max === min) {
        return scores.map(() => 0.5); // Se tutti i punteggi sono uguali, assegna un valore medio
    }
    return scores.map(score => (score - min) / (max - min));
}

/**
 * Esegue una ricerca ibrida combinando similarità del coseno (semantica) e TF-IDF (parole chiave).
 * @param {string} query - La query di ricerca.
 * @param {object[]} candidateDocs - I documenti candidati (già pre-filtrati).
 * @param {number[]} semanticSimilarities - I punteggi di similarità del coseno pre-calcolati.
 * @param {number} [alpha=0.6] - Il peso da dare alla ricerca semantica (0.6 -> 60% semantica, 40% keyword).
 * @returns {object[]} I documenti ordinati per punteggio ibrido.
 */
export function performHybridSearch(query, candidateDocs, semanticSimilarities, alpha = 0.6) {
    if (candidateDocs.length === 0) {
        return [];
    }

    // --- 1. KEYWORD SEARCH (TF-IDF) ---
    const tfidf = new TfIdf();
    candidateDocs.forEach(doc => tfidf.addDocument(doc.content));
    
    const keywordScores = new Array(candidateDocs.length).fill(0);
    tfidf.tfidfs(query.toLowerCase(), (i, measure) => {
        if (i < keywordScores.length) {
            keywordScores[i] = measure;
        }
    });

    // --- 2. NORMALIZZAZIONE PUNTEGGI ---
    // Normalizza entrambi i set di punteggi in un range [0, 1] per poterli combinare
    const normalizedSemanticScores = normalizeScores(semanticSimilarities.map(s => s.similarity));
    const normalizedKeywordScores = normalizeScores(keywordScores);

    // --- 3. CALCOLO PUNTEGGIO IBRIDO ---
    const hybridScores = candidateDocs.map((doc, i) => {
        const semanticScore = normalizedSemanticScores[i];
        const keywordScore = normalizedKeywordScores[i];

        // Formula del punteggio ibrido pesato
        const hybridScore = (alpha * semanticScore) + ((1 - alpha) * keywordScore);

        return {
            ...doc, // Mantiene testo, metadati, ecc.
            similarity: hybridScore, // Sovrascrive la similarità con il nuovo punteggio ibrido
            _debug: { // Aggiunge metadati di debug per i log
                semantic: semanticScore.toFixed(4),
                keyword: keywordScore.toFixed(4),
                original: semanticSimilarities[i].similarity.toFixed(4)
            }
        };
    });

    // --- 4. ORDINAMENTO FINALE ---
    hybridScores.sort((a, b) => b.similarity - a.similarity);

    log(`[Hybrid Search] 🧬 Ricerca ibrida completata. Esempio Top Score: ${hybridScores[0]?.similarity.toFixed(4)} (Sem: ${hybridScores[0]?._debug.semantic}, Key: ${hybridScores[0]?._debug.keyword})`);

    return hybridScores;
}