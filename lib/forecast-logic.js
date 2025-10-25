import { format, parseISO } from 'date-fns';
import * as geoUtils from './utils/geo.utils.js';
import { myCache } from './utils/cache.manager.js';
import { runProactiveAnalysis } from './services/proactive_analysis.service.js';
import { fetchAllWeatherData } from './services/weather.service.js'; // NUOVO IMPORT
import { assembleForecastData } from './domain/forecast.assembler.js'; // NUOVO IMPORT

export const POSILLIPO_COORDS = '40.813,14.208';
const cacheLocks = new Map();

const log = (message, source = 'Orchestrator') => {
    console.log(`--- [${source}] ${message} ---`);
};

async function resolveLocationToCoords(location) {
    const locationLower = location.toLowerCase().trim();
    if (locationLower === 'posillipo') {
        const [lat, lon] = POSILLIPO_COORDS.split(',').map(parseFloat);
        return { lat, lon, name: 'Posillipo' };
    }
    if (location.includes(',')) {
        const [lat, lon] = location.split(',').map(parseFloat);
        if (!isNaN(lat) && !isNaN(lon)) {
            // Per ora, un reverse geocoding semplice non è implementato qui, usiamo le coordinate
            return { lat, lon, name: location };
        }
    }
    // In un'implementazione futura, qui si potrebbe chiamare un'API di geocoding.
    throw new Error(`Località "${location}" non valida. Usare "lat,lon" o "Posillipo".`);
}

async function getUnifiedForecastData(location) {
    log(`Inizio richiesta per: "${location}"`);
    const resolved = await resolveLocationToCoords(location);
    const lat = resolved.lat.toFixed(3);
    const lon = resolved.lon.toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    const isPosillipo = geoUtils.areCoordsNear(normalizedLocation, POSILLIPO_COORDS);
    const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`;

    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT per ${cacheKey}. Attendo...`);
        return cacheLocks.get(cacheKey);
    }
    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            log(`Cache HIT per ${resolved.name} (${normalizedLocation})`);
            return cachedData;
        }
        log(`Cache MISS per ${resolved.name} (${normalizedLocation}). Fetching...`);

        const updatePromise = new Promise(async (resolve, reject) => {
            try {
                // 1. DATA FETCHING (Delegato)
                const [wwoDailyData, openMeteoHourlyData, stormglassData] = await fetchAllWeatherData(lat, lon, isPosillipo);

                // Validazione dati grezzi
                if (!wwoDailyData || wwoDailyData.length === 0 || !openMeteoHourlyData || Object.keys(openMeteoHourlyData).length === 0) {
                    throw new Error("Dati grezzi da WWO o OpenMeteo non validi o mancanti.");
                }

                // 2. DATA ASSEMBLY (Delegato)
                const finalForecast = assembleForecastData(wwoDailyData, openMeteoHourlyData, stormglassData, resolved.name);

                const apiResponse = {
                    fonti: "Open-Meteo & WorldWeatherOnline" + (stormglassData ? " & Stormglass (Corrente)" : ""),
                    forecast: finalForecast,
                    dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
                };

                myCache.set(cacheKey, apiResponse);
                log(`Cache aggiornata per: ${cacheKey}`);

                // 3. TRIGGER AI (Invariato)
                (async () => {
                    try {
                        await runProactiveAnalysis(apiResponse, normalizedLocation);
                    } catch (e) {
                        console.error("[PROACTIVE-TRIGGER-ERROR]", e.message);
                    }
                })();

                resolve(apiResponse);
            } catch (error) {
                reject(error);
            }
        });

        cacheLocks.set(cacheKey, updatePromise);
        return await updatePromise;

    } catch (error) {
        log(`ERRORE durante l'aggiornamento per ${cacheKey}: ${error.message}`);
        const cachedData = myCache.get(cacheKey); // Tenta un fallback sulla cache anche in caso di errore
        if (cachedData) {
            log(`Fallback su dati cachati dopo errore per: ${cacheKey}`);
            return cachedData;
        }
        throw error; // Rilancia l'errore se non c'è neanche la cache
    } finally {
        if (cacheLocks.has(cacheKey)) {
            cacheLocks.delete(cacheKey);
        }
    }
}

export {
    getUnifiedForecastData,
    getUnifiedForecastData as fetchAndProcessForecast,
};