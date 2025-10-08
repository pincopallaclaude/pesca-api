/**
 * @typedef {Object} Fact
 * @property {string} title - Breve titolo descrittivo.
 * @property {string[]} keywords - Parole chiave per la ricerca semplificata.
 * @property {string} content - Il contenuto vero e proprio della conoscenza.
 */

/**
 * Array di fatti fondamentali (il nostro "Seed" di conoscenza).
 * In un'implementazione reale, questi sarebbero i dati caricati da ChromaDB.
 * @type {Fact[]}
 */
const knowledgeFacts = [
    {
        title: "Spigola (Regola d'Oro)",
        keywords: ["spigola", "mareggiata", "scaduta", "ossigenata", "tramonto"],
        content: "La spigola è un predatore costiero che ama l'acqua ben ossigenata. Le condizioni ideali sono **mare in scaduta dopo una mareggiata** e pressione in calo. Caccia attivamente all'alba e al tramonto vicino a scogliere e foci. È meglio usare esche artificiali in superficie con mare mosso.",
    },
    {
        title: "Orata (Regola d'Oro)",
        keywords: ["orata", "calmo", "sabbiosi", "alta pressione", "soleggiata"],
        content: "L'orata preferisce fondali **sabbiosi** e **mare calmo**. Le alte pressioni e le giornate soleggiate la rendono più attiva. Si nutre di molluschi (granchi, cozze), quindi le esche a fondo (come l'arenicola o il bibi) sono efficaci durante le ore diurne.",
    },
    {
        title: "Traina Costiera",
        keywords: ["traina", "palamite", "serra", "vento debole", "ore centrali"],
        content: "La traina costiera è efficace con mare calmo o **poco mosso** e **vento debole**. È una tecnica rivolta a predatori come palamite e serra, specialmente nelle ore centrali della giornata o con forti correnti.",
    },
    {
        title: "Regola Generale della Pressione",
        keywords: ["pressione", "tempo", "cambiamento", "generale"],
        content: "Un rapido calo della pressione barometrica spesso indica un imminente cambiamento del tempo e spinge i pesci predatori a **mangiare attivamente**. Una pressione alta e stabile favorisce i grufolatori (come l'orata) e il mare calmo.",
    },
];

/**
 * Funzione semplificata che simula la ricerca di conoscenza in base a una descrizione delle condizioni.
 * In un'implementazione reale, questa userebbe la Ricerca Vettoriale (ChromaDB).
 * @param {string | null | undefined} conditions - Una stringa che descrive le condizioni meteo o il tipo di pesca/pesce cercato.
 * @returns {string} Una stringa di conoscenza pertinente o un messaggio di fallback.
 */
function getKnowledgeFor(conditions) {
    // CORREZIONE CRITICA: Assicurarsi che 'conditions' sia una stringa prima di chiamare toLowerCase()
    // Se 'conditions' è null, undefined, o non una stringa, usa una stringa vuota ('') per prevenire il crash.
    const safeConditions = (typeof conditions === 'string' && conditions) ? conditions : '';
    
    // Ora è sicuro chiamare toLowerCase()
    const searchTerms = safeConditions.toLowerCase().split(/\s+/);

    // Cerca i fatti la cui parola chiave è contenuta nei termini di ricerca.
    const matchingFacts = knowledgeFacts.filter(fact => 
        fact.keywords.some(keyword => searchTerms.includes(keyword))
    );

    if (matchingFacts.length === 0) {
        // Se non trova corrispondenze dirette, restituisce la Regola Generale
        const generalRule = knowledgeFacts.find(f => f.title === "Regola Generale della Pressione");
        return generalRule 
            ? `Non ho trovato consigli specifici. Ecco una regola generale: ${generalRule.content}`
            : "Non ho trovato consigli specifici o regole generali.";
    }

    // Combina i contenuti dei fatti corrispondenti in un'unica stringa
    const knowledgeSnippets = matchingFacts.map(fact => 
        `[${fact.title}]: ${fact.content}`
    );

    return knowledgeSnippets.join('\n---\n');
}

module.exports = { getKnowledgeFor };
