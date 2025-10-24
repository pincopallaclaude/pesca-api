// /api/analyze-day-fallback.js

import { myCache, analysisCache } from '../lib/utils/cache.manager.js';
import { fetchAndProcessForecast } from '../lib/forecast-logic.js';
import { POSILLIPO_COORDS } from '../lib/utils/constants.js'; // CAMBIATO: Ora usa constants.js
import { mcpClient } from '../lib/services/mcp-client.service.js';
import geoUtils from '../lib/utils/geo.utils.js'; // NUOVO IMPORT

/**
 * Gestore per l'analisi del giorno on-demand, utilizzato come fallback o per
 * richieste dirette di analisi AI.
 * Recupera i dati meteo (da cache o fetch) e chiama il tool MCP
 * 'generate_analysis' per ottenere l'analisi di pesca in formato Markdown.
 * @param {object} req - Oggetto della richiesta Express (deve contenere lat, lon in body).
 * @param {object} res - Oggetto della risposta Express.
 */
async function analyzeDayFallbackHandler(req, res) {
    console.log(`[RAG-Fallback] Received on-demand request.`);
    const { lat, lon } = req.body;
    
    try {
        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Lat/Lon richiesti.' });
        }

        const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        const forecastCacheKey = `forecast-data-v-refactored-${normalizedLocation}`;
        let forecastForDay = myCache.get(forecastCacheKey)?.forecast?.[0];

        if (!forecastForDay) {
            console.warn(`[RAG-Fallback] Cache MISS per dati meteo. Forcing fetch.`);
            const fullForecastData = await fetchAndProcessForecast(`${lat},${lon}`);
            forecastForDay = fullForecastData?.forecast?.[0];
        } else {
             console.log('[RAG-Fallback] Cache HIT per dati meteo. Procedo all\'analisi.');
        }

        if (!forecastForDay) {
            throw new Error("Dati meteo non trovati né in cache né tramite fetch.");
        }
        
        // Logica di fallback intelligente per il nome della località
        let locationForTitle = 'località sconosciuta';
        
        if (forecastForDay.location?.name) {
            locationForTitle = forecastForDay.location.name;
        } else if (geoUtils.areCoordsNear(normalizedLocation, POSILLIPO_COORDS)) { // USA LA FUNZIONE ROBUSTA
            locationForTitle = 'Zona Posillipo (Napoli)';
        } else {
            locationForTitle = normalizedLocation; // Fallback finale sulle coordinate normalizzate
        }
        
        // **CHIAMATA CHIAVE: Usa il tool MCP**
        const result = await mcpClient.callTool('generate_analysis', {
            weatherData: forecastForDay,
            location: locationForTitle,
        });
        
        if (result.isError || !result.content || result.content.length === 0) {
            const errorMessage = result.content?.[0]?.text || 'Errore sconosciuto dal tool MCP';
            throw new Error(errorMessage);
        }
        
        // La risposta del tool MCP è ora garantita (dal prompt) essere puro Markdown.
        // Non è più necessaria alcuna logica di parsing o conversione JSON.
        const finalAnalysis = result.content[0].text;

        // =================================================================
        // LOG DIAGNOSTICO: ISPEZIONA LA RISPOSTA GREZZA DELL'AI
        console.log("--- INIZIO RISPOSTA GREZZA AI (FALLBACK) ---");
        console.log(finalAnalysis);
        console.log("--- FINE RISPOSTA GREZZA AI (FALLBACK) ---");
        // =================================================================

        if (!finalAnalysis || finalAnalysis.trim().length < 50) {
            throw new Error("L'analisi MCP estratta è vuota o insufficiente.");
        }
        
        const successResponse = {
            status: 'success',
            data: finalAnalysis.trim(),
            metadata: result.metadata
        };
        
        // Caching del risultato
        const analysisCacheKey = `analysis-v2-${normalizedLocation}`;
        analysisCache.set(analysisCacheKey, finalAnalysis.trim());
        console.log("[RAG-Fallback] Analisi cachata e inviata con successo.");
        
        return res.status(200).json(successResponse);

    } catch (error) {
        console.error("[RAG-Fallback] ERROR during on-demand analysis:", error.stack);
        const errorMessage = error.message || "Errore sconosciuto durante l'elaborazione dell'analisi AI.";
        return res.status(500).json({ status: 'error', message: errorMessage });
    }
}

export default analyzeDayFallbackHandler;
