// /lib/utils/cache.manager.js
const NodeCache = require('node-cache');

// TTL standard di 6 ore per i dati meteo
const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

module.exports = { myCache };