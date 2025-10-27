// /lib/services/proactive_analysis.service.js

/**
 * Proactive Analysis Service (v7.2 - Enhanced Metadata)
 * Genera analisi AI in background e la salva in cache con metadata completi
 */

import { mcpClient } from './mcp-client.service.js';
import { analysisCache } from '../utils/cache.manager.js';
import axios from 'axios'; // Assicurati che axios sia installato
import { JsonDecoder } from '../utils/JsonDecoder.js'; // Manteniamo JsonDecoder.js: l'errore è ora nel Dockerfile o .dockerignore

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

/**
 * Reverse geocoding Geoapify
 * @param {number} lat 
 * @param {number} lon 
 * @returns {Promise<string>} Nome località formattato
 */
async function reverseGeocode(lat, lon) {
  try {
    if (!GEOAPIFY_API_KEY) {
      throw new Error("GEOAPIFY_API_KEY non definita.");
    }
    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}&lang=it`;
    
    // Imposta un timeout ragionevole per evitare blocchi
    const response = await axios.get(url, { timeout: 5000 });
    const feature = response.data?.features?.[0];
    
    if (!feature) {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    
    const props = feature.properties;
    
    // Priorità: suburb > city > town > village > name
    const name = props.suburb || props.city || props.town || props.village || props.name;
    const city = props.city || props.town;
    
    // Formattazione intelligente
    if (name && city && name !== city) {
      return `${name} (zona ${city})`;
    } else if (name) {
      return name;
    } else {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
    
  } catch (error) {
    console.error(`[Proactive-AI] ⚠️ Reverse geocoding fallito: ${error.message}`);
    // Fallback in caso di errore Geoapify
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background utilizzando il server MCP.
 * @param {object} forecastData - L'oggetto completo della previsione.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813_14.209").
 */
export async function runProactiveAnalysis(forecastData, locationKey) {
  try {
    const [latStr, lonStr] = locationKey.split('_');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);

    const startTime = Date.now();
    
    // Assumiamo che forecastData.location.name contenga inizialmente le coordinate grezze
    let locationName = forecastData?.location?.name || locationKey; 
    
    // === STEP 1: Reverse Geocoding per nome località ===
    // Verifica se il nome attuale è composto solo da numeri/punti/segni.
    if (/^[\d\.\-,\s]+$/.test(locationName)) { 
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
    // La chiave di cache deve essere compatibile con quella usata in server.js
    const cacheKey = `${lat.toFixed(3)}_${lon.toFixed(3)}`; 
    
    const enrichedCache = {
      analysis,                                 // Testo Markdown
      locationName,                             // Nome human-readable
      modelUsed: metadata.modelUsed || 'gemini-2.5-flash',
      modelProvider: metadata.provider || 'google',
      complexityLevel: metadata.complexityLevel,
      generatedAt: new Date().toISOString(),
      timingMs: elapsed,
      version: 2, // Per tracciare la versione arricchita della cache
    };
    
    // NOTA: analysisCache è un'istanza di un gestore di cache (es. node-cache)
    // che gestisce il TTL. analysisCache.set accetta la chiave e l'oggetto da salvare.
    analysisCache.set(cacheKey, enrichedCache);

    console.log(`[Proactive-AI] 💾 Cache salvata: ${cacheKey} (${enrichedCache.modelUsed}).`);
    
    return enrichedCache;
    
  } catch (error) {
    console.error(`[Proactive-AI] ❌ Errore generazione proattiva per ${locationKey}:`, error.message);
    // Non propaghiamo l'errore
    return null;
  }
}
