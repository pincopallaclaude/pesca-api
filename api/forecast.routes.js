// /api/forecast.routes.js

import express from 'express';
import { fetchAndProcessForecast } from '../lib/forecast-logic.js';

const router = express.Router();

router.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || '40.813,14.208';
        const forecastData = await fetchAndProcessForecast(location);
        res.json(forecastData);
    } catch (error) {
        console.error("[API-Error] /api/forecast:", error.message);
        res.status(500).json({ error: error.message });
    }
});

router.get('/api/update-cache', async (req, res) => {
    if (req.query.secret !== process.env.CRON_SECRET_KEY) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        await fetchAndProcessForecast('40.813,14.208'); 
        res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON] Errore durante l'aggiornamento:", error.message);
        res.status(500).json({ status: 'error' });
    }
});

export default router;