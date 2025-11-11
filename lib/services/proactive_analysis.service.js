// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import axios from 'axios';
import { executeFishingAgent } from '../agents/fishing.agent.js'; // NUOVO: L'agente
import { saveEpisode } from '../db/memory.engine.js'; // NUOVO: Per salvare l'episodio
import logger from '../utils/logger.js'; // Usiamo il logger standard

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * [PHANTOM Service v3 con Agente] Genera un'analisi proattiva,
 * la salva come "episodio di memoria" e mette in cache il risultato per l'UI.
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
        
        // === STEP 1: Reverse Geocoding (invariato) ===
        const locationName = await reverseGeocode(lat, lon, firstDayForecast.location.name);
        
        // === STEP 2: Prepara contesto e query per l'agente ===
        const initialContext = {
            currentLocation: { name: locationName, lat, lon },
            currentWeather: firstDayForecast,
            currentTime: new Date().toISOString(),
            sessionId: sessionId
        };

        const proactiveQuery = `Basandomi sui dati meteo odierni per ${locationName}, fornisci un'analisi di pesca dettagliata e proattiva. Considera le migliori tecniche, esche e spot potenziali. Sii conciso ma esauriente.`;

        // === STEP 3: Esegui l'agente per generare l'analisi ===
        logger.log(`[Proactive-Agent] Invocazione dell'agente per generare l'analisi...`);
        const analysisText = await executeFishingAgent(proactiveQuery, initialContext);

        if (!analysisText || typeof analysisText !== 'string') {
            throw new Error("L'agente non ha restituito un'analisi valida.");
        }
        
        const elapsed = Date.now() - startTime;
        logger.log(`[Proactive-Agent] ✅ Analisi generata dall'agente in ${elapsed}ms`);

        // === STEP 4: Salva l'analisi come nuovo episodio di memoria ===
        const episodeData = {
            sessionId,
            location: { name: locationName, lat, lon },
            weatherData: firstDayForecast, // Salviamo lo snapshot meteo completo
            pescaScore: firstDayForecast.pescaScore, // Punteggio aggregato del giorno
            aiAnalysis: analysisText,
            userAction: 'proactive_generation' // Azione speciale per tracciare
        };
        
        await saveEpisode(episodeData);

        // === STEP 5: Salva in cache per l'UI (come prima) ===
        const enrichedCacheData = {
            analysis: analysisText,
            locationName,
            modelUsed: 'agent_driven', // Il modello specifico è gestito dall'agente
            modelProvider: 'multi',
            generatedAt: new Date().toISOString(),
            timingMs: elapsed,
        };
        
        analysisCache.set(cacheKey, enrichedCacheData);
        logger.log(`[Proactive-Agent] 💾 Analisi salvata in cache e come episodio di memoria.`);

    } catch (error) {
        logger.error(`[Proactive-Agent] ❌ Errore durante l'analisi proattiva:`, error);
        // Non propaghiamo l'errore per non bloccare il flusso principale
    }
}

/**
 * Esegue il reverse geocoding tramite Geoapify, con fallback.
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
        return defaultName; // Fallback in caso di errore
    }
}