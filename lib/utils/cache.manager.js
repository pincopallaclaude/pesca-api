// /lib/utils/cache.manager.js

const NodeCache = require('node-cache');

// Cache principale per i dati meteo grezzi (TTL 6 ore)
const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 1200 });

// Map per gestire i lock ed evitare fetch duplicati
const cacheLocks = new Map();

// --- MODIFICA (aggiungi) ---
// [P.H.A.N.T.O.M. - FASE 1] Cache dedicata per le analisi AI pre-generate.
// TTL più breve (1 ora) perché l'analisi è valida per un periodo più ristretto.
const analysisCache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
// --- FINE MODIFICA ---

// --- CONTESTO SUCCESSIVO (invariato) ---
module.exports = {
    myCache,
    cacheLocks,
// --- MODIFICA (aggiungi) ---
    analysisCache,
// --- FINE MODIFICA ---
};
