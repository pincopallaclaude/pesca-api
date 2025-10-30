// /lib/utils/query-expander.js

const log = (msg) => process.stderr.write(`${msg}\n`);

// Dizionario dei sinonimi. Facilmente espandibile.
const FISHING_SYNONYMS = {
  'spigola': ['branzino', 'ragno'],
  'orata': ['sparus aurata'],
  'sarago': ['sargo', 'saraco'],
  'serra': ['pesce serra', 'bluefish'],
  'calamaro': ['totano', 'seppia', 'eging'],
  'spinning': ['artificiali', 'lancio', 'esche finte'],
  'surfcasting': ['spiaggia', 'beach casting'],
  'molo': ['diga', 'pontile'],
  'scogliera': ['rocce', 'costa rocciosa'],
  'notturna': ['notte', 'buio']
};

/**
 * Espande una query di ricerca aggiungendo sinonimi per i termini chiave trovati.
 * @param {string} query - La query originale.
 * @returns {string} La query espansa con i sinonimi.
 */
export function expandQuery(query) {
  let expandedQuery = query;
  const originalQueryLower = query.toLowerCase();
  
  // 🔥 LOG: Contiene i termini trovati e i sinonimi aggiunti per il debug
  const expansionLog = [];

  for (const [term, synonyms] of Object.entries(FISHING_SYNONYMS)) {
    // Controlla se il termine è presente nella query originale come parola intera
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(originalQueryLower)) {
      const synonymsToAdd = synonyms.join(' ');
      expandedQuery += ` ${synonymsToAdd}`;
      expansionLog.push({ term, added: synonymsToAdd });
    }
  }

  // Se ci sono state espansioni, logga i dettagli
  if (expansionLog.length > 0) {
    const logDetails = expansionLog.map(e => `${e.term} -> [${e.added}]`).join(', ');
    log(`[Query Expander] 📝 Espansione applicata: ${logDetails}`);
  }

  return expandedQuery;
}