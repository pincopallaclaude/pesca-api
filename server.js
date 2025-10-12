// server.js

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

// --- Import dei moduli ---
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js');
const { analysisCache } = require('./lib/utils/cache.manager.js');
const { triggerProactiveAnalysis } = require('./lib/services/proactive_analysis.service.js'); // Import del servizio corretto
const { generateAnalysisStream } = require('./lib/services/gemini.service.js'); // Assumiamo esista una funzione streaming
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

// --- ROUTES API ---
app.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || '40.813238367880984,14.2089443032_204635'; // Corretto typo coordinate
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

// =================================================================================
// --- ARCHITETTURA P.H.A.N.T.O.M. v2 - ENDPOINT AI CORRETTI ---
// =================================================================================

// [STEP 1] Il frontend chiama questo endpoint. È leggero e istantaneo.
app.post('/api/get-analysis', (req, res) => {
    try {
        const { lat, lon } = req.body;
        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Coordinate mancanti.' });
        }

        const cacheKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        const cachedAnalysis = analysisCache.get(cacheKey);

        if (cachedAnalysis) {
            console.log(`[Analysis-Endpoint] Cache HIT per ${cacheKey}. Invio analisi pre-generata.`);
            return res.status(200).json({ status: 'ready', data: cachedAnalysis });
        } else {
            console.log(`[Analysis-Endpoint] Cache MISS per ${cacheKey}. Il client avvierà lo streaming.`);
            return res.status(200).json({ status: 'pending' });
        }
    } catch (error) {
        console.error("[Analysis-Endpoint] Errore critico:", error.stack);
        return res.status(500).json({ status: 'error', message: 'Errore interno nel server.' });
    }
});

// [STEP 2 - FALLBACK] Se get-analysis risponde 'pending', il frontend chiama questo.
app.post('/api/analyze-day-stream', async (req, res) => {
    // 1. Setup della connessione SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
        const { lat, lon } = req.body;
        if (!lat || !lon) {
            throw new Error("Coordinate mancanti per lo streaming.");
        }
        
        const locationCoords = `${lat},${lon}`;
        
        // La logica di generazione AI ora è centralizzata.
        // Chiamiamo una versione adattata di 'triggerProactiveAnalysis' che accetta una callback per lo streaming.
        // Questo richiede un refactoring del service per evitare duplicazione di codice.
        // Per questo esempio, assumiamo che triggerProactiveAnalysis sia stato modificato per supportarlo.
        // NOTA: Il modo migliore per farlo sarebbe creare una funzione helper condivisa.
        // Per ora, replichiamo la logica di costruzione del prompt per completezza.

        const fullForecastData = await fetchAndProcessForecast(locationCoords);
        const firstDay = fullForecastData.forecast[0];

        // --- Logica di costruzione del prompt (UNIFICATA) ---
        const NOT_SPECIFIED = 'N/A';
        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;
        const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');
        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        const knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato...";
        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${weatherDesc}, Temp: ${firstDay.tempMinMax || NOT_SPECIFIED}
            - Vento: ${ventoDati}, Mare: ${mare}
            - Pressione: ${pressione}, Acqua: ${(firstDay.currentHourData && firstDay.currentHourData.waterTemperature) || NOT_SPECIFIED}C
            - Luna: ${firstDay.moonPhase || NOT_SPECIFIED}, Maree: Alta ${firstDay.altaMarea || NOT_SPECIFIED}, Bassa ${firstDay.bassaMarea || NOT_SPECIFIED}
        `.trim();
        const prompt = `Sei Meteo Pesca AI... ${weatherTextForPrompt} ... ${knowledgeText} ... Adesso, basandoti su tutto, genera l'analisi in Markdown.`.trim(); // Prompt completo

        // --- Chiamata alla funzione di streaming del servizio Gemini ---
        await generateAnalysisStream(prompt, (chunk, isDone) => {
            res.write(`data: ${JSON.stringify({ chunk, done: isDone })}\n\n`);
            if (isDone) {
                // Salva il risultato completo nella cache anche al termine dello streaming
                const cacheKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
                analysisCache.set(cacheKey, chunk);
                console.log(`[Streaming-Endpoint] Analisi per ${cacheKey} completata e salvata in cache.`);
                res.end();
            }
        });
        
    } catch (error) {
        console.error("[Streaming-Endpoint] Errore durante lo streaming:", error.stack);
        const errorPayload = JSON.stringify({ error: "Errore durante la generazione dell'analisi.", done: true });
        res.write(`data: ${errorPayload}\n\n`);
        res.end();
    }
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/get-analysis`);
    console.log(`Endpoint STREAMING FALLBACK: POST http://localhost:${PORT}/api/analyze-day-stream`);
});