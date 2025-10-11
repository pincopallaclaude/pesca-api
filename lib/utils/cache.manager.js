// /lib/utils/cache.manager.js

/**
 * @fileoverview Gestore centralizzato della cache NodeCache.
 * Responsabilità Unica: Inizializzare l'istanza di NodeCache e definire i prefissi chiave.
 */
const NodeCache = require('node-cache');

// TTL standard di 6 ore (6 * 60 * 60 = 21600 secondi) per i dati meteo
const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

// --- MODIFICA (sostituisci/aggiungi) ---
// Prefisso per isolare le analisi AI pre-generate (P.H.A.N.T.O.M. cache)
const ANALYSIS_CACHE_PREFIX = 'AI_ANALYSIS'; 
// --- FINE MODIFICA ---

module.exports = { 
    myCache,
    ANALYSIS_CACHE_PREFIX, // Esporta il nuovo prefisso per uso in proactive_analysis.service.js
};