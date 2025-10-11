// /lib/server.js

// Load environment variables
require('dotenv').config();

// --- BLOCCO DI VERIFICA CHIAVE API ---
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY non trovata nel file .env!");
    process.exit(1); // Interrompe l'esecuzione del server se la chiave manca
}
// -----------------------------

const express = require('express');
const path = require('path');
const cors = require('cors'); // CORS middleware for handling cross-origin requests

// Assicuriamoci di importare correttamente le nostre logiche
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js'); 
const { myCache } = require('./lib/utils/cache.manager.js'); 
// NB: generateAnalysis e queryKnowledgeBase NON sono più necessarie qui.
// La logica RAG (analyze-day) è stata spostata nel flusso P.H.A.N.T.O.M.
const autocompleteHandler = require('./api/routes/autocomplete.route.js'); 
const reverseGeocodeHandler = require('./api/routes/reverse-geocode.route.js');

// Importiamo la nuova rotta P.H.A.N.T.O.M.
const analysisRoutes = require('./api/routes/analysis.route.js'); 

const app = express();
const PORT = process.env.PORT || 3001; 

// --- MIDDLEWARE ---
app.use(cors()); // Abilita CORS per tutte le rotte
app.use(express.json()); // Per parsare i body delle richieste in JSON
app.use(express.static(path.join(__dirname, 'public'))); // Serve il frontend

// --- ROUTE DI CONTROLLO "SONO VIVO?" ---
app.get('/', (req, res) => {
    res.status(200).send('Pesca API Server is running!');
});

// --- ROUTE API PRIMARIE ---

// 1. Previsioni Meteo (innesca P.H.A.N.T.O.M.)
app.get('/api/forecast', async (req, res) => {
    try {
        // Uso di una location di default se non specificata (Napoli)
        const location = req.query.location || '40.813238367880984,14.208944303204635';
        const forecastData = await fetchAndProcessForecast(location); // fetchAndProcessForecast ora innesca triggerProactiveAnalysis in background

        try {
            res.json(forecastData);
        } catch (stringifyError) {
            console.error('[SERVER-FATAL] JSON.stringify FAILED:', stringifyError.message, stringifyError.stack);
            res.status(500).json({ error: "Failed to serialize response." });
        }
        
    } catch (error) {
        console.error("[Server Error] /api/forecast:", error.message, error.stack);
        res.status(500).json({ message: "An error occurred while getting forecast data.", error: error.message });
    }
});

// 2. Cache Update (per Cron Job)
app.get('/api/update-cache', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.CRON_SECRET_KEY) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const locationToUpdate = '40.813238367880984,14.208944303204635';
        await fetchAndProcessForecast(locationToUpdate); // Innesca anche l'analisi proattiva
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON JOB] Error during update:", error.message);
        return res.status(500).json({ status: 'error' });
    }
});

// 3. Servizi Geospaziali
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);

// =========================================================================
// --- ENDPOINT P.H.A.N.T.O.M. (Consegna Veloce Analisi IA) ---
// =========================================================================
// Questa rotta è gestita interamente dal modulo analysisRoutes (analysis.route.js).
// La rotta '/api/analyze-day' sincrona è stata RIMO SSA per evitare il blocco.
app.use('/api', analysisRoutes); 
// analysisRoutes gestisce ora '/api/get-analysis'

// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint Forecast ATTIVO: GET http://localhost:${PORT}/api/forecast`);
    console.log(`Endpoint Analysis P.H.A.N.T.O.M. ATTIVO: GET http://localhost:${PORT}/api/get-analysis`);
});