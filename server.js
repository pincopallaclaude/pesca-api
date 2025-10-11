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
const cors = require('cors'); 
const { v4: uuidv4 } = require('uuid'); // Per generare ID unici per l'analisi

// Assicuriamoci di importare correttamente le nostre logiche
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js'); 
const { myCache } = require('./lib/utils/cache.manager.js'); 
const { generateAnalysis } = require('./lib/services/gemini.service.js'); 
const { queryKnowledgeBase } = require('./lib/services/vector.service.js'); 

// ***************************************************************
// CORREZIONE PER L'ERRORE DI BUILD: 
// Usiamo i path esistenti, evitando di importare file .route.js inesistenti
// ***************************************************************
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

// --- ROUTES API (Logica esistente intatta) ---
app.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || '40.813238367880984,14.208944303204635';
        const forecastData = await fetchAndProcessForecast(location);

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
// --- NUOVO ENDPOINT P.H.A.N.T.O.M. (Proactive Analysis) ---
// =========================================================================

// Funzione generica per la logica di analisi (Estratta per riutilizzo)
async function runAnalysisLogic(lat, lon, userQuery) {
    const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";
    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`; 
    let fullResponse = myCache.get(cacheKey);

    if (!fullResponse) {
        console.warn(`[P.H.A.N.T.O.M. Logic] Cache MISS. Forcing data fetch for ${normalizedLocation}.`);
        fullResponse = await fetchAndProcessForecast(`${lat},${lon}`);
    }
    
    const forecastDataArray = fullResponse.forecast || [];
    if (!forecastDataArray || forecastDataArray.length === 0) {
         throw new Error("Impossibile recuperare i dati meteo marini per l'analisi.");
    }

    const firstDay = forecastDataArray[0] || {}; 
    const NOT_SPECIFIED = 'Informazione non disponibile'; 
    
    const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
    const mare = firstDay.mare || NOT_SPECIFIED;
    const pressione = firstDay.pressione || NOT_SPECIFIED;
    const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;

    const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');

    const ALL_KEY_DATA_MISSING = [weatherDesc, mare, pressione, ventoDati].every(d => d === NOT_SPECIFIED);
    let knowledgeText;
    let relevantDocs = [];
    
    if (ALL_KEY_DATA_MISSING) {
        knowledgeText = "CONTESTO MANCANTE: Non è stato possibile reperire i dati specifici...";
    } else {
        relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato...";
    }

    const weatherTextForPrompt = `
        Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
        - Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.tempMinMax || 'N/A'}
        - Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
        - Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${(firstDay.currentHourData && firstDay.currentHourData.waterTemperature) || 'N/A'}C
        - Luna: ${firstDay.moonPhase || 'N/A'}, Maree: Alta ${firstDay.altaMarea || 'N/A'}, Bassa ${firstDay.bassaMarea || 'N/A'}
    `.trim();
    
    const prompt = `
        Sei Meteo Pesca AI, un esperto di pesca sportiva. Analizza i dati e i fatti pertinenti per dare un consiglio strategico in Italiano.
        ... (Istruzioni di prompt omesse per brevità, usa la tua formattazione completa) ...
        --- DATI METEO-MARINI ---
        ${weatherTextForPrompt}
        --- FATTI RILEVANTI DALLA KNOWLEDGE BASE ---
        ${knowledgeText}
        DOMANDA DELL'UTENTE: "${finalUserQuery}"
        Adesso, basandoti su tutto, genera l'analisi in Markdown.
    `.trim();

    const rawAiResponse = await generateAnalysis(prompt);
    
    let analysisResult = rawAiResponse; // Assume raw Markdown
    try {
        const cleanedJsonText = rawAiResponse.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
        const parsedJson = JSON.parse(cleanedJsonText);
        if (parsedJson && parsedJson.analysis) {
             analysisResult = parsedJson.analysis;
        }
    } catch (e) {
        // Fallback: non è un JSON, usa la risposta grezza
    }
    
    if (!analysisResult || analysisResult.trim().length < 50) {
        throw new Error("L'analisi estratta è vuota o insufficiente.");
    }
    
    return analysisResult.trim();
}

/**
 * P.H.A.N.T.O.M. Endpoint (Proactive Handling of Analysis Timeouts and Management)
 * Questo endpoint gestisce l'analisi in modo asincrono.
 * 1. Cerca l'analisi completa in cache. Se trovata (HIT), risponde 200 immediatamente.
 * 2. Se non trovata (MISS), avvia l'analisi in background e risponde 202 (Accepted).
 */
app.post('/api/analyze-proactive', async (req, res) => {
    const { lat, lon, userQuery } = req.body; 
    
    if (!lat || !lon) {
        return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
    }

    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    // Chiave specifica per l'analisi AI
    const analysisCacheKey = `ai-analysis-v1-${normalizedLocation}`; 

    // 1. Controlla la Cache (P.H.A.N.T.O.M. HIT)
    const cachedAnalysis = myCache.get(analysisCacheKey);
    if (cachedAnalysis) {
        console.log(`[P.H.A.N.T.O.M.] HIT! Servita analisi da cache. (200 OK)`);
        return res.status(200).json({ 
            status: 'cachedInstant', // Corrisponde a AnalysisStatus.cachedInstant
            analysisMarkdown: cachedAnalysis 
        });
    }

    // 2. Cache MISS: Avvia l'analisi in background e rispondi 202 (P.H.A.N.T.O.M. MISS)
    const analysisId = uuidv4();
    console.log(`[P.H.A.N.T.O.M.] MISS. Avviata analisi in background. ID: ${analysisId}. (202 Accepted)`);

    // Avvia il calcolo AI in background, senza bloccare la risposta HTTP
    // Questo è il cuore del P.H.A.N.T.O.M.
    runAnalysisLogic(lat, lon, userQuery)
        .then(resultMarkdown => {
            // Analisi completata, memorizza in cache per le richieste future (P.H.A.N.T.O.M. READY)
            const TTL_SECONDS = 3 * 3600; // Esempio: 3 ore di TTL
            myCache.set(analysisCacheKey, resultMarkdown, TTL_SECONDS);
            console.log(`[P.H.A.N.T.O.M.] Analisi AI completata e memorizzata in cache. Key: ${analysisCacheKey}`);
        })
        .catch(error => {
            console.error(`[P.H.A.N.T.O.M. ERROR] Analisi AI fallita per ${normalizedLocation}: ${error.message}`);
            // Non memorizziamo l'errore in cache per riprovare alla prossima richiesta
        });
        
    // Rispondi immediatamente 202 Accepted al client.
    return res.status(202).json({ 
        status: 'pendingProactive', // Corrisponde a AnalysisStatus.pendingProactive
        message: 'Analysis calculation started in background. Please try again shortly.',
        analysisId: analysisId 
    });
});

// =========================================================================
// --- VECCHIO ENDPOINT /api/analyze-day (Sincrono e Deprecato) ---
// =========================================================================
app.post('/api/analyze-day', async (req, res) => {
    console.warn(`[DEPRECATED] Chiamata a /api/analyze-day. Si prega di migrare a /api/analyze-proactive.`);
    
    try {
        const { lat, lon, userQuery } = req.body;
        
        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
        }
        
        // Esegui la logica di analisi sincrona (blocca la richiesta)
        const finalAnalysis = await runAnalysisLogic(lat, lon, userQuery);

        const successResponse = {
            status: 'success',
            data: finalAnalysis,
        };
        return res.status(200).json(successResponse);

    } catch (error) {
        console.error("[pesca-api] ERROR during SINC analysis /api/analyze-day:", error.stack);
        const errorResponse = { status: 'error', message: error.message || "Errore durante l'elaborazione dell'analisi AI." };
        return res.status(500).json(errorResponse);
    }
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint P.H.A.N.T.O.M. ATTIVO: POST http://localhost:${PORT}/api/analyze-proactive`);
});