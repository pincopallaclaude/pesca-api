// /api/analyze-day-fallback.js

import { myCache, analysisCache } from '../lib/utils/cache.manager.js';
import { mcpClient } from '../lib/services/mcp-client.service.js';
import { normalizeCoords } from '../lib/utils/geo.utils.js';

export default async function analyzeDayFallbackHandler(req, res) {
    console.log(`[RAG-Fallback] Received on-demand request.`);
    const { lat, lon } = req.body;

    try {
        const normalizedLocation = normalizeCoords(`${lat},${lon}`);
        const forecastCacheKey = `forecast-data-v-refactored-${normalizedLocation}`;
        const forecastData = myCache.get(forecastCacheKey);

        if (!forecastData || forecastData.forecast.length === 0) {
            return res.status(404).json({ error: "Dati meteo non in cache. Eseguire prima un forecast." });
        }
        
        console.log(`[RAG-Fallback] Cache HIT per dati meteo. Procedo all'analisi.`);
        const firstDayForecast = forecastData.forecast[0];

        // Usa lo stesso tool multi-model del flusso proattivo per coerenza
        const result = await mcpClient.callTool('analyze_with_best_model', {
            weatherData: firstDayForecast,
            location: firstDayForecast.location?.name || normalizedLocation,
        });

        if (result.isError) {
            throw new Error(result.content[0]?.text || 'Errore sconosciuto dal tool MCP');
        }

        const analysis = result.content[0].text;
        const metadata = result.metadata || {};

        // Salva l'analisi appena generata nella cache per richieste future
        const analysisCacheKey = `${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}`;
        const enrichedCacheData = { analysis, metadata };
        analysisCache.set(analysisCacheKey, enrichedCacheData);
        
        console.log(`[RAG-Fallback] Analisi generata, cachata e inviata con successo.`);
        
        // Ritorna l'oggetto JSON strutturato che il frontend si aspetta
        res.status(200).json({
            status: 'ready',
            analysis: analysis,
            metadata: metadata,
        });

    } catch (error) {
        console.error("[RAG-Fallback] ❌ Errore:", error.message);
        res.status(500).json({ error: `Fallback analysis failed: ${error.message}` });
    }
}