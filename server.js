// server.js

// Load environment variables
require('dotenv').config();

// --- BLOCCO DI VERIFICA CHIAVE API ---
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY non trovata nel file .env!");
    process.exit(1);
}
// -----------------------------

const express = require('express');
const path = require('path');
const cors = require('cors');

// --- MODIFICA: Importazioni aggiornate per P.H.A.N.T.O.M. ---
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js');
const { myCache, analysisCache } = require('./lib/utils/cache.manager.js');
// Importiamo SIA la generazione normale CHE quella in streaming da Gemini
const { generateAnalysis, streamAnalysis } = require('./lib/services/gemini.service.js'); 
const { queryKnowledgeBase } = require('./lib/services/vector.service.js');
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

const app = express();
const PORT = process.env.PORT || 3001; 

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ROUTE DI CONTROLLO "SONO VIVO?" ---
app.get('/', (req, res) => {
    res.status(200).send('Pesca API Server is running!');
});

// --- ROUTES API PRINCIPALI ---
app.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || '40.813238367880984,14.208944303204635';
        const forecastData = await fetchAndProcessForecast(location);
        res.json(forecastData);
    } catch (error) {
        console.error("[Server Error] /api/forecast:", error.message, error.stack);
        res.status(500).json({ message: "An error occurred while getting forecast data.", error: error.message });
    }
});

app.get('/api/update-cache', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.CRON_SECRET_KEY) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        const locationToUpdate = '40.813238367880984,14.208944303204635';
        await fetchAndProcessForecast(locationToUpdate); 
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON JOB] Error during update:", error.message);
        return res.status(500).json({ status: 'error' });
    }
});

app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);


// =========================================================================
// --- ARCHITETTURA P.H.A.N.T.O.M. ---
// =========================================================================

// --- 1. ENDPOINT DI CONTROLLO ISTANTANEO ---
app.post('/api/get-analysis', (req, res) => {
    try {
        const { lat, lon } = req.body;
        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Coordinate mancanti.' });
        }
        const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        const cacheKey = `analysis-${normalizedLocation}`;
        const cachedAnalysis = analysisCache.get(cacheKey);

        if (cachedAnalysis) {
            res.status(200).json({ status: 'ready', data: cachedAnalysis });
        } else {
            res.status(202).json({ status: 'pending', message: 'Analisi in elaborazione.' });
        }
    } catch (error) {
        console.error("[GetAnalysis Endpoint] Errore:", error.message);
        res.status(500).json({ status: 'error', message: 'Errore interno del server.' });
    }
});

// --- 2. ENDPOINT DI FALLBACK (STREAMING) ---
app.post('/api/analyze-day-stream', async (req, res) => {
    // A. Setup della connessione per Server-Sent Events (SSE)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const { lat, lon, userQuery } = req.body;
        const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";
        if (!lat || !lon) throw new Error("Coordinate mancanti.");

        // B. Recupera i dati meteo (dalla cache o con un nuovo fetch se necessario)
        const locationCoords = `${lat},${lon}`;
        const fullResponse = await fetchAndProcessForecast(locationCoords);
        const firstDay = fullResponse.forecast?.[0];
        if (!firstDay) throw new Error("Dati meteo non disponibili per l'analisi.");

        // C. Costruisci il prompt (logica duplicata da /analyze-day, ideale da estrarre in un builder)
        const weatherTextForPrompt = `Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'}...`; // Usa il tuo template completo qui
        const knowledgeText = "Nessun fatto specifico trovato..."; // Semplificato, implementa la query al Vector DB qui
        const prompt = `Sei Meteo Pesca AI... ${weatherTextForPrompt} ... ${knowledgeText} ... DOMANDA: "${finalUserQuery}" ...`; // Usa il tuo template completo

        // D. Chiama la versione STREAMING di Gemini
        await streamAnalysis(prompt, (chunk, isDone, fullText) => {
            if (isDone) {
                // Quando finisce, salva l'analisi completa nella cache proattiva
                const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
                const cacheKey = `analysis-${normalizedLocation}`;
                analysisCache.set(cacheKey, fullText);
                
                // Invia un segnale di chiusura e termina la connessione
                res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
                res.end();
            } else {
                // Durante lo streaming, invia i chunk di testo al frontend
                res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
        });

    } catch (error) {
        console.error("[Stream Endpoint] Errore:", error.message);
        // Invia un evento di errore al client prima di chiudere
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
    }
});


// --- ENDPOINT OBSOLETO ---
// La rotta /api/analyze-day non è più utilizzata dal frontend P.H.A.N.T.O.M.
// Può essere rimossa o tenuta per debug.
// app.post('/api/analyze-day', ... );


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/get-analysis`);
    console.log(`Endpoint RAG STREAM (FALLBACK): POST http://localhost:${PORT}/api/analyze-day-stream`);
});