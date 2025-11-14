// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import axios from 'axios';
import { generateProactiveAnalysis } from '../agents/fishing.agent.js'; 
import { saveEpisode } from '../db/memory.engine.js';
import * as logger from '../utils/logger.js';

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * [PROACTIVE Service] Genera un'analisi proattiva per una specifica località,
 * la salva come episodio di memoria e mette in cache il risultato arricchito per l'UI.
 * * NOTA: Questo servizio ora si aspetta solo i dati del forecast e le coordinate normalizzate.
 * Le coordinate (lat/lon) non sono più passate in un oggetto separato.
 * * @param {Object} fullForecastData - Oggetto completo da getUnifiedForecastData (contenente l'array 'forecast')
 * @param {string} normalizedLocation - Coordinate normalizzate es. "40.813,14.208"
 * @returns {Object} Un oggetto contenente i metadati dell'analisi per la risposta al Cron Job.
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
        if (!fullForecastData?.forecast?.[0]) {
             throw new Error("Dati di previsione meteo mancanti o non validi per l'analisi proattiva.");
        }
        
        const firstDayForecast = fullForecastData.forecast[0];

        // === STEP 1: Reverse Geocoding ===
        // Recupera il nome della località usando il fallback dai dati meteo
        const locationName = await reverseGeocode(lat, lon, firstDayForecast.location.name);
        const locationObject = { name: locationName, lat, lon };
        
        // === STEP 2: Esegui l'agente con la funzione dedicata P.H.A.N.T.O.M. ===
        logger.log(`[Proactive-Agent] Invocazione di generateProactiveAnalysis...`);
        // L'agente riceve il forecast del primo giorno e l'oggetto localita'
        const agentResult = await generateProactiveAnalysis(firstDayForecast, locationObject);

        if (!agentResult || !agentResult.success || !agentResult.response) {
            throw new Error("L'agente non ha restituito un'analisi valida.");
        }
        
        logger.log(`[Proactive-Agent] ✅ Analisi generata in ${agentResult.execution_time_ms}ms. Iterazioni: ${agentResult.iterations}, Tool usati: ${agentResult.tools_used.join(', ')}`);

        // === STEP 3: Salva l'analisi come nuovo episodio di memoria (per il RAG) ===
        const episodeData = {
            sessionId,
            location: locationObject,
            weatherData: firstDayForecast,
            pescaScore: firstDayForecast.pescaScoreData.numericScore,
            aiAnalysis: agentResult.response,
            userAction: 'proactive_generation'
        };
        
        // Assumo che saveEpisode sia la funzione corretta da usare
        const episodeId = await saveEpisode(episodeData); 

        // === STEP 4: Salva in cache per l'UI istantanea (Endpoint /api/get-analysis) ===
        const enrichedCacheData = {
            analysis: agentResult.response,
            locationName,
            modelUsed: 'gemini-agent', 
            modelProvider: 'google',
            complexityLevel: 'Proactive',
            generatedAt: new Date().toISOString(),
            timingMs: agentResult.execution_time_ms,
            agentMetadata: {
                iterations: agentResult.iterations,
                tools_used: agentResult.tools_used,
            }
        };
        
        analysisCache.set(cacheKey, enrichedCacheData, 21600); // TTL di 6 ore
        logger.log(`[Proactive-Agent] 💾 Analisi salvata in cache e come episodio di memoria (${episodeId}).`);

        const totalExecutionTime = Date.now() - startTime;
        
        return {
            status: 'ok',
            cacheKey: cacheKey,
            episodeId: episodeId,
            totalExecutionTimeMs: totalExecutionTime
        };

    } catch (error) {
        logger.error(`[Proactive-Agent] ❌ Errore durante l'analisi proattiva:`, error.message);
        throw error; // Rilancia l'errore per farlo gestire all'endpoint Cron Job (server.js)
    }
}

/**
 * Esegue il reverse geocoding tramite Geoapify, con fallback. (Mantenuto invariato)
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