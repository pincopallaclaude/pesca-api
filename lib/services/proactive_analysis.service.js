// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import axios from 'axios';
// --- INIZIO MODIFICHE IMPORT ---
import { generateProactiveAnalysis } from '../agents/fishing.agent.js'; // Importa la funzione corretta
import { saveEpisode } from '../db/memory.engine.js';
import * as logger from '../utils/logger.js';
// --- FINE MODIFICHE IMPORT ---

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * [PHANTOM Service v4 con Agente Ibrido] Genera un'analisi proattiva,
 * la salva come episodio di memoria e mette in cache il risultato arricchito per l'UI.
 * @param {Object} fullForecastData - Oggetto completo da getUnifiedForecastData
 * @param {string} normalizedLocation - Coordinate normalizzate es. "40.813,14.208"
 */
export async function runProactiveAnalysis(fullForecastData, normalizedLocation) {
    const startTime = Date.now();
    const [latStr, lonStr] = normalizedLocation.split(',');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    const cacheKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
    const sessionId = `proactive_${Date.now()}`;

    logger.log(`[Proactive-Agent] 🚀 Avvio analisi proattiva per ${normalizedLocation}`);

    try {
        const firstDayForecast = fullForecastData.forecast[0];

        // === STEP 1: Reverse Geocoding ===
        const locationName = await reverseGeocode(lat, lon, firstDayForecast.location.name);
        const locationObject = { name: locationName, lat, lon };
        
        // === STEP 2: Esegui l'agente con la funzione dedicata P.H.A.N.T.O.M. ===
        logger.log(`[Proactive-Agent] Invocazione di generateProactiveAnalysis...`);
        // La nuova funzione dell'agente si aspetta i dati del forecast e l'oggetto location
        const agentResult = await generateProactiveAnalysis(firstDayForecast, locationObject);

        if (!agentResult || !agentResult.success || !agentResult.response) {
            throw new Error("L'agente non ha restituito un'analisi valida.");
        }
        
        logger.log(`[Proactive-Agent] ✅ Analisi generata in ${agentResult.execution_time_ms}ms. Iterazioni: ${agentResult.iterations}, Tool usati: ${agentResult.tools_used.join(', ')}`);

        // === STEP 3: Salva l'analisi come nuovo episodio di memoria ===
        const episodeData = {
            sessionId,
            location: locationObject,
            weatherData: firstDayForecast,
            pescaScore: firstDayForecast.pescaScoreData.numericScore,
            aiAnalysis: agentResult.response,
            userAction: 'proactive_generation'
        };
        
        await saveEpisode(episodeData);

        // === STEP 4: Salva in cache per l'UI con i metadati dall'agente ===
        const enrichedCacheData = {
            analysis: agentResult.response,
            locationName,
            modelUsed: 'gemini-agent', // Ora è un agente
            modelProvider: 'google',
            generatedAt: new Date().toISOString(),
            timingMs: agentResult.execution_time_ms,
            // Aggiungiamo i metadati specifici dell'agente per il debug
            agentMetadata: {
                iterations: agentResult.iterations,
                tools_used: agentResult.tools_used,
            }
        };
        
        analysisCache.set(cacheKey, enrichedCacheData, 21600); // TTL di 6 ore
        logger.log(`[Proactive-Agent] 💾 Analisi salvata in cache e come episodio di memoria.`);

    } catch (error) {
        logger.error(`[Proactive-Agent] ❌ Errore durante l'analisi proattiva:`, error);
    }
}

/**
 * Esegue il reverse geocoding tramite Geoapify, con fallback. (INVARIATO)
 */
async function reverseGeocode(lat, lon, fallbackName) {
    const defaultName = fallbackName || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    if (!GEOAPIFY_API_KEY) {
        logger.warn('[Proactive-Agent] GEOAPIFY_API_KEY mancante, uso fallback.');
        return defaultName;
    }
    try {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}&lang=it`;
        const response = await axios.get(url, { timeout: 3000 });
        const feature = response.data?.features?.[0];
        
        if (!feature) return defaultName;
        
        const props = feature.properties;
        const name = props.suburb || props.city || props.town || props.village || props.name;
        return name || defaultName;

    } catch (error) {
        logger.error(`[Proactive-Agent] ⚠️ Reverse geocoding fallito, uso fallback:`, error.message);
        return defaultName;
    }
}