// /lib/services/proactive_analysis.service.js

/**
 * Proactive Analysis Service (v7.2 - Enhanced Metadata)
 * Genera analisi AI in background e la salva in cache con metadata completi
 */

import { mcpClient } from './mcp-client.service.js';
import { analysisCache } from '../utils/cache.manager.js';
import { POSILLIPO_COORDS } from '../utils/constants.js'; // Mantenuto per compatibilità
import { areCoordsNear } from '../utils/geo.utils.js';     // Mantenuto per compatibilità
import axios from 'axios'; // Necessario per Geoapify

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * Reverse geocoding Geoapify
 * Converte le coordinate in un nome di località leggibile.
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<string>} Nome località formattato
 */
async function reverseGeocode(lat, lon) {
  try {
    if (!GEOAPIFY_API_KEY) {
      // Fallback se la chiave non è definita
      console.warn("[Proactive-AI] ⚠️ GEOAPIFY_API_KEY non definita. Saltando geocoding.");
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}&lang=it`;
    
    const response = await axios.get(url, { timeout: 5000 });
    const feature = response.data?.features?.[0];
    
    if (!feature) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    
    const props = feature.properties;
    
    // Priorità: suburb > city > town > village > name
    const name = props.suburb || props.city || props.town || props.village || props.name;
    const city = props.city || props.town;
    
    // Formattazione intelligente (es. "Chiaia (zona Napoli)")
    if (name && city && name !== city) {
      return `${name} (zona ${city})`;
    } else if (name) {
      return name;
    } else {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    
  } catch (error) {
    console.error(`[Proactive-AI] ⚠️ Reverse geocoding fallito: ${error.message}`);
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background utilizzando il server MCP.
 * @param {object} forecastData - L'oggetto completo della previsione.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813_14.209").
 */
async function runProactiveAnalysis(forecastData, locationKey) {
  try {
    // La locationKey è nel formato "lat_lon" (es. "40.813_14.209")
    // NOTA: Se la locationKey usa la virgola, qui fallirà. Assumiamo "lat_lon".
    const [latStr, lonStr] = locationKey.split('_');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    const startTime = Date.now();
    
    // Inizializza con il nome esistente (se c'è) o la chiave
    let locationName = forecastData?.location?.name || locationKey; 
    
    // === STEP 1: Reverse Geocoding per nome località ===
    // Esegue il geocoding inverso solo se il nome non è già stato risolto
    if (/^[\d\.\-,\s]+$/.test(locationName) || locationName === locationKey) { 
      console.log(`[Proactive-AI] 🗺️ Reverse geocoding per coordinate...`);
      locationName = await reverseGeocode(lat, lon);
      console.log(`[Proactive-AI] ✅ Località risolta: ${locationName}`);
    } else {
      console.log(`[Proactive-AI] 🟢 Località già risolta: ${locationName}`);
    }
    
    // Verifica dati previsione
    const firstDayForecast = forecastData?.forecast?.[0];
    if (!firstDayForecast) {
      console.warn(`[Proactive-AI] Dati forecast vuoti per ${locationKey}. Analisi annullata.`);
      return;
    }

    // === STEP 2: Generazione con Multi-Model via MCP ===
    console.log(`[Proactive-AI] 🚀 Avvio analisi multi-model per ${locationName}`);

    const result = await mcpClient.callTool('analyze_with_best_model', {
      weatherData: firstDayForecast,
      location: locationName, // ← Usa nome human-readable
    });
    
    const analysis = result.content[0]?.text;
    const metadata = result.metadata || {};
    
    const elapsed = Date.now() - startTime;
    console.log(`[Proactive-AI] ✅ Analisi completata via ${metadata.modelUsed || 'AI'} in ${elapsed}ms`);
    
    if (!analysis || analysis.trim().length < 50) {
      console.warn(`[Proactive-AI] ⚠️ Analisi generata per ${locationName} vuota o troppo corta. Non cachata.`);
      return;
    }

    // === STEP 3: Salva in cache con metadata arricchiti ===
    const cacheKey = locationKey.replace(/,/g, '_'); // Usa la locationKey originale (es. 40.813_14.209)
    
    const enrichedCache = {
      analysis, 
      locationName, 
      modelUsed: metadata.modelUsed || 'gemini-2.5-flash',
      modelProvider: metadata.provider || 'google',
      complexityLevel: metadata.complexityLevel,
      generatedAt: new Date().toISOString(),
      timingMs: elapsed,
      version: 2, // Versione cache arricchita
    };
    
    analysisCache.set(cacheKey, enrichedCache);

    console.log(`[Proactive-AI] 💾 Cache salvata: ${cacheKey} (${enrichedCache.modelUsed}).`);
    
    return enrichedCache;
    
  } catch (error) {
    console.error(`[Proactive-AI] ❌ Errore generazione proattiva per ${locationKey}:`, error.message);
    return null;
  }
}

export { runProactiveAnalysis };
