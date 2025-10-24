// /lib/utils/cache.manager.js

import NodeCache from 'node-cache';

// TTL standard di 6 ore per i dati meteo
export const myCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });

// TTL di 6 ore (allineato a myCache) per le analisi AI pre-generate
export const analysisCache = new NodeCache({ stdTTL: 21600, checkperiod: 120 });