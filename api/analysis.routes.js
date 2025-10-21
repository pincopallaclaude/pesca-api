// /api/analysis.routes.js

import express from 'express';
import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache, analysisCache } from '../utils/cache.manager.js';
import { fetchAndProcessForecast } from '../forecast-logic.js'; // Importiamo per il fallback

const router = express.Router();

// ENDPOINT 1: Get Analysis (Cache Check - Logica invariata, formato del payload aggiornato)
router.post('/get-analysis', (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) return res.status(400).json({ status: 'error', message: 'Lat/Lon richiesti.' });
    
    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const cacheKey = `analysis-v1-${normalizedLocation}`;
    
    const cachedAnalysis = analysisCache.get(cacheKey);

    if (cachedAnalysis) {
        console.log(`[API] ✅ Cache HIT per analisi ${normalizedLocation}.`);
        res.status(200).json(cachedAnalysis); // cachedAnalysis è già { status: 'success', data: '...' }
    } else {
        console.log(`[API] ⏳ Cache MISS per analisi ${normalizedLocation}.`);
        res.status(202).json({ status: 'pending' });
    }
});

// ENDPOINT 2: Analyze Day Fallback (Ora usa MCP)
router.post('/analyze-day-fallback', async (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) return res.status(400).json({ status: 'error', message: 'Lat/Lon richiesti.' });

    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const analysisCacheKey = `analysis-v1-${normalizedLocation}`;
    const forecastCacheKey = `forecast-data-v-refactored-${normalizedLocation}`;

    try {
        let forecastData = myCache.get(forecastCacheKey);
        if (!forecastData) {
            console.warn(`[API-Fallback] Cache MISS per dati meteo. Forcing fetch per ${normalizedLocation}.`);
            forecastData = await fetchAndProcessForecast(`${lat},${lon}`);
        }

        const firstDayData = forecastData?.forecast?.[0];
        if (!firstDayData) {
            return res.status(404).json({ error: 'Dati meteo non disponibili per l\'analisi.' });
        }
        
        const result = await mcpClient.callTool('generate_analysis', {
            weatherData: firstDayData,
            location: firstDayData.locationName,
        });

        const analysisText = result.content[0].text;
        const responsePayload = {
            status: 'success',
            data: analysisText,
            metadata: result.metadata
        };

        analysisCache.set(analysisCacheKey, responsePayload);
        res.json(responsePayload);

    } catch (error) {
        console.error('[API-Fallback] Errore:', error.stack);
        res.status(500).json({ error: error.message });
    }
});

// ENDPOINT 3: NUOVO - Insight Specifico
router.post('/get-insight', async (req, res) => {
    const { topic, context } = req.body;
    if (!topic) return res.status(400).json({ error: 'Il campo "topic" è richiesto.' });

    try {
        const result = await mcpClient.callTool('get_fishing_insight', { topic, context });
        res.json({
            status: 'success',
            data: result.content[0].text,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;    