// /lib/services/proactive_analysis.service.js

import { mcpClient } from './mcp-client.service.js';
import { analysisCache } from '../utils/cache.manager.js';
import axios from 'axios';

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * [PHANTOM Service v2] Genera analisi AI in background, la arricchisce con metadati
 * e la salva nell'analysisCache.
 * @param {Object} fullForecastData - Oggetto completo da getUnifiedForecastData
 * @param {string} normalizedLocation - Coordinate normalizzate es. "40.813,14.208"
 */
export async function runProactiveAnalysis(fullForecastData, normalizedLocation) {
    try {
        const firstDayForecast = fullForecastData.forecast[0];
        const [latStr, lonStr] = normalizedLocation.split(',');
        const lat = parseFloat(latStr);
        const lon = parseFloat(lonStr);
        
        console.log(`[Proactive-AI] 🚀 Avvio analisi proattiva per ${normalizedLocation}`);
        const startTime = Date.now();

        // === STEP 1: Reverse Geocoding per nome località ===
        let locationName = firstDayForecast.location.name || normalizedLocation;
        if (/^[\d\.\-]+,[\d\.\-]+$/.test(locationName.trim())) {
            console.log(`[Proactive-AI] 🗺️ Reverse geocoding per coordinate...`);
            locationName = await reverseGeocode(lat, lon);
            console.log(`[Proactive-AI] ✅ Località risolta: ${locationName}`);
        }

        const toolToCall = 'analyze_with_best_model';
        const toolParams = {
            weatherData: firstDayForecast,
            location: locationName,
        };

        console.log(`[Proactive-AI DEBUG] Chiamo il tool: '${toolToCall}' con parametri:`, Object.keys(toolParams));
        
        // === STEP 2: Generazione con Multi-Model via MCP - NUOVA CHIAMATA PER DEBUG ===
        const result = await mcpClient.callTool(toolToCall, toolParams);
        
        // La logica successiva userà il risultato mock da mcp-client.service.js in modalità debug.

        if (result.isError) {
            throw new Error(result.content[0]?.text || 'Errore dal tool MCP');
        }

        const analysis = result.content[0].text;
        const metadata = result.metadata || {};
        const elapsed = Date.now() - startTime;
        console.log(`[Proactive-AI] ✅ Analisi completata via ${metadata.modelUsed || 'AI'} in ${elapsed}ms`);

        // === STEP 3: Salva in cache con metadata arricchiti ===
        const cacheKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`;
        const enrichedCacheData = {
            analysis,
            locationName,
            modelUsed: metadata.modelUsed || 'gemini-2.5-flash',
            modelProvider: metadata.provider || 'google',
            complexityLevel: metadata.complexityLevel,
            generatedAt: new Date().toISOString(),
            timingMs: elapsed,
        };
        
        analysisCache.set(cacheKey, enrichedCacheData);
        console.log(`[Proactive-AI] 💾 Cache salvata: ${cacheKey} (${metadata.modelUsed})`);

    } catch (error) {
        console.error(`[Proactive-AI] ❌ Errore generazione proattiva:`, error.message);
        // Non propaghiamo l'errore per non bloccare il flusso principale
    }
}

/**
 * Esegue il reverse geocoding tramite Geoapify.
 */
async function reverseGeocode(lat, lon) {
    if (!GEOAPIFY_API_KEY) {
        console.warn('[Proactive-AI] GEOAPIFY_API_KEY mancante, fallback su coordinate.');
        return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    try {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}&lang=it`;
        const response = await axios.get(url, { timeout: 5000 });
        const feature = response.data?.features?.[0];
        
        if (!feature) return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
        
        const props = feature.properties;
        const name = props.suburb || props.city || props.town || props.village || props.name;
        const city = props.city || props.town;
        
        if (name && city && name.toLowerCase() !== city.toLowerCase()) {
            return `${name} (zona ${city})`;
        } else if (name) {
            return name;
        }
        return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    } catch (error) {
        console.error(`[Proactive-AI] ⚠️ Reverse geocoding fallito:`, error.message);
        return `${lat.toFixed(3)}, ${lon.toFixed(3)}`; // Fallback in caso di errore
    }
}