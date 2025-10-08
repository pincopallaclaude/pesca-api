// /lib/domain/knowledge_base.js
// This module defines the core knowledge documents for the fishing assistant.
// It exports an array of knowledge facts that will be embedded into ChromaDB. 

/**
 * @typedef {Object} Fact
 * @property {string} title - Breve titolo descrittivo.
 * @property {string} name - Internal name for metadata. (Equivalent to title)
 * @property {string} topic - The knowledge category.
 * @property {string} content - Il contenuto vero e proprio della conoscenza (questo sarà il documento da vettorializzare).
 */

/**
 * Array di fatti fondamentali (il nostro "Seed" di conoscenza).
 * ATTENZIONE: Le chiavi 'keywords' sono state rimosse perché la ricerca ora avviene tramite vettori semantici.
 * Abbiamo aggiunto 'name' e 'topic' come metadata per la collezione ChromaDB.
 * @type {Fact[]}
 */
const KNOWLEDGE_DOCUMENTS = [
    {
        title: "Spigola (Regola d'Oro)",
        name: "spigola_base",
        topic: "specie",
        content: "La spigola è un predatore costiero che ama l'acqua ben ossigenata. Le condizioni ideali sono **mare in scaduta dopo una mareggiata** e pressione in calo. Caccia attivamente all'alba e al tramonto vicino a scogliere e foci. È meglio usare esche artificiali in superficie con mare mosso.",
    },
    {
        title: "Orata (Regola d'Oro)",
        name: "orata_base",
        topic: "specie",
        content: "L'orata preferisce fondali **sabbiosi** e **mare calmo**. Le alte pressioni e le giornate soleggiate la rendono più attiva. Si nutre di molluschi (granchi, cozze), quindi le esche a fondo (come l'arenicola o il bibi) sono efficaci durante le ore diurne.",
    },
    {
        title: "Traina Costiera",
        name: "traina_costiera_base",
        topic: "tecnica",
        content: "La traina costiera è efficace con mare calmo o **poco mosso** e **vento debole**. È una tecnica rivolta a predatori come palamite e serra, specialmente nelle ore centrali della giornata o con forti correnti.",
    },
    {
        title: "Regola Generale della Pressione",
        name: "pressione_generale",
        topic: "generale",
        content: "Un rapido calo della pressione barometrica spesso indica un imminente cambiamento del tempo e spinge i pesci predatori a **mangiare attivamente**. Una pressione alta e stabile favorisce i grufolatori (come l'orata) e il mare calmo.",
    },
];

// Poiché stiamo passando alla Ricerca Vettoriale con ChromaDB:
// 1. Rimuoviamo la funzione legacy 'getKnowledgeFor'.
// 2. Esportiamo l'array grezzo 'KNOWLEDGE_DOCUMENTS' affinché lo script seeder
//    possa accedervi e vettorializzarlo.
module.exports = {
    KNOWLEDGE_DOCUMENTS // We export the raw array for the seeder
};