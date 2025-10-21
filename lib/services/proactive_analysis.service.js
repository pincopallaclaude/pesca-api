// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import { mcpClient } from './mcp-client.service.js';

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background utilizzando il tool MCP.
 * Non restituisce nulla, ma salva il risultato finale nella analysisCache.
 * @param {object} unifiedForecastData - L'oggetto completo della previsione.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813,14.209").
 */
export async function runProactiveAnalysis(unifiedForecastData, locationKey) {
  // La chiave della cache per l'analisi deve corrispondere a quella usata dalle route
  const cacheKey = `analysis-v1-${locationKey}`;

  try {
    console.log(`[Proactive-AI] Avvio analisi in background per ${locationKey} via MCP.`);

    // Estrai il primo giorno di previsione per l'analisi
    const weatherDataForAnalysis = unifiedForecastData.forecast?.[0];
    if (!weatherDataForAnalysis) {
      console.warn(`[Proactive-AI] Dati forecast vuoti per ${locationKey}. Analisi annullata.`);
      return;
    }
    
    // Chiama il tool 'generate_analysis' tramite il client MCP
    const result = await mcpClient.callTool('generate_analysis', {
      weatherData: weatherDataForAnalysis, // Passa l'oggetto dati del primo giorno
      location: weatherDataForAnalysis.locationName,
    });

    const analysisText = result.content[0].text;

    // Caching del risultato (logica identica alla versione precedente)
    if (analysisText && analysisText.trim().length > 50) {
      const responseToCache = {
        status: 'success',
        data: analysisText.trim(),
      };
      analysisCache.set(cacheKey, responseToCache);
      console.log(`[Proactive-AI] ✅ Analisi per ${locationKey} generata e cachata con successo.`);
    } else {
      console.warn(`[Proactive-AI] ⚠️ Analisi generata per ${locationKey} vuota o troppo corta. Non cachata.`);
    }

  } catch (error) {
    console.error(`[Proactive-AI] ❌ Errore durante l'analisi in background per ${locationKey}:`, error.message);
  }
}