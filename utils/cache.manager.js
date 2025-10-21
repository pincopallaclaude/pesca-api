// /lib/utils/cache.manager.js
const NodeCache = require('node-cache');

// TTL standard di 6 ore per i dati meteo
const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

// TTL di 2 ore per le analisi AI pre-generate
const analysisCache = new NodeCache({ stdTTL: 7200, checkperiod: 60 });

module.exports = { myCache, analysisCache }