// /lib/forecast-logic.js

import { format, parseISO } from 'date-fns';
import * as geoUtils from './utils/geo.utils.js';
import { myCache } from './utils/cache.manager.js';
import { runProactiveAnalysis } from './services/proactive_analysis.service.js';
import { fetchStormglassData } from './services/stormglass.service.js';
import { fetchOpenMeteoHourly, fetchWwoDaily } from './services/weather-api.service.js';
import { assembleForecastData } from './domain/weather-aggregator.service.js';
import { POSILLIPO_COORDS } from './utils/constants.js'; // Assumendo che ora sia qui

const cacheLocks = new Map();

const log = (message, source = 'Master Fetch') => {
    console.log(`--- [${source}] ${message} ---`);
};

async function getUnifiedForecastData(location) {
    log(`Inizio richiesta per location: "${location}"`, 'MASTER FETCH');
    
    // NOTA: La logica di resolveLocationToCoords è stata rimossa per semplicità
    // e si assume che l'input sia sempre "lat,lon" o "Posillipo".
    // Se necessario, può essere estratta in un suo file di utils/geo.service.js
    
    let coords;
    if (location.toLowerCase().trim() === 'posillipo') {
        coords = POSILLIPO_COORDS;
    } else {
        coords = location;
    }

    const [lat_str, lon_str] = coords.split(',');
    const lat = parseFloat(lat_str).toFixed(3);
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    log(`Location normalizzata a 3 decimali: "${normalizedLocation}"`, 'Master Fetch Log');
    
    const isPosillipo = geoUtils.areCoordsNear(normalizedLocation, POSILLIPO_COORDS);
    const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`;

    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT: Chiave ${cacheKey} in fase di aggiornamento. Attendo...`, 'Master Fetch Log');
        return cacheLocks.get(cacheKey);
    }
    
    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            log(`Cache HIT for ${location} (${normalizedLocation})`, 'Master Fetch Log');
            return cachedData;
        }
        
        log(`Cache MISS for ${location} (${normalizedLocation}). Acquisizione LOCK e Fetching new data...`, 'Master Fetch Log');

        let resolveLock, rejectLock;
        const updatePromise = new Promise((resolve, reject) => { resolveLock = resolve; rejectLock = reject; });
        cacheLocks.set(cacheKey, updatePromise);

        console.time("PERF: Promise.all(API_Calls)");
        const promises = [
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
        ];

        if (isPosillipo) {
            log(`Location è Posillipo. Aggiungo fetch premium (Stormglass)...`, 'Master Fetch Log');
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed:', err.message);
                return null; // Non bloccare in caso di errore
            }));
        } else {
            promises.push(Promise.resolve(null)); // Placeholder per mantenere la struttura di `await Promise.all`
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);
        console.timeEnd("PERF: Promise.all(API_Calls)");

        // Log di riepilogo
        console.log(`\nAPI Status: WWO=${wwoDailyData ? 'OK' : 'ERR'}, OM=${openMeteoHourlyData ? 'OK' : 'ERR'}, SG=${isPosillipo ? (stormglassData ? 'OK' : 'ERR') : 'N/A'}\n`);

        // Delega l'assemblaggio dei dati al nuovo servizio
        const apiResponse = assembleForecastData(wwoDailyData, openMeteoHourlyData, stormglassData);
        
        // Aggiungi informazione Stormglass se presente
        if (stormglassData) {
            apiResponse.fonti += " & Stormglass (Corrente)";
        }

        myCache.set(cacheKey, apiResponse);
        log(`Cache aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');
        
        (async () => {
            try {
                await runProactiveAnalysis(apiResponse, normalizedLocation);
            } catch (e) {
                console.error("[PROACTIVE-TRIGGER-ERROR] L'analisi proattiva in background è fallita:", e.message);
            }
        })();

        resolveLock(apiResponse);
        return apiResponse;
        
    } catch (error) {
        log(`ERRORE durante l'aggiornamento forecast per ${cacheKey}: ${error.message}`, 'Master Fetch Log');
        const cachedData = myCache.get(cacheKey);
        if (cacheLocks.has(cacheKey)) {
            if(typeof rejectLock === 'function') rejectLock(error);
        }
        if (cachedData) {
            log(`Fallback su dati cachati dopo errore per: ${cacheKey}`, 'Master Fetch Log');
            return cachedData;
        }
        throw error;
    } finally {
        if (cacheLocks.has(cacheKey)) {
            cacheLocks.delete(cacheKey);
        }
    }
}

// Manteniamo gli export richiesti dagli altri moduli per piena retrocompatibilità
export {
    getUnifiedForecastData,
    getUnifiedForecastData as fetchAndProcessForecast,
};