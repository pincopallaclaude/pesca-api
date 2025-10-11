// /lib/utils/cache.manager.js
    
// --- CONTESTO PRECEDENTE (invariato) ---
const NodeCache = require('node-cache');

// TTL standard di 6 ore per i dati meteo
const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

// [P.H.A.N.T.O.M. Cache] Cache specializzata per le analisi AI pre-generate.
// TTL più breve (2 ore) perché l'analisi invecchia più in fretta dei dati grezzi.
const analysisCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Mappa per gestire i lock durante l'aggiornamento della cache principale,
// per prevenire race conditions.
const cacheLocks = new Map();

module.exports = { myCache, analysisCache, cacheLocks };

  