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

// Assicuriamoci di importare correttamente le nostre logiche
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js'); // Ora importa solo quello che serve
const { myCache, analysisCache } = require('./lib/utils/cache.manager.js');
const { generateAnalysis } = require('./lib/services/gemini.service.js'); // Funzione per la chiamata a Gemini
const { queryKnowledgeBase } = require('./lib/services/vector.service.js'); // Import RAG corretto
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

const app = express();
// Usiamo la porta definita nel file esistente:
const PORT = process.env.PORT || 3001; 

// --- MIDDLEWARE ---
app.use(cors()); // Abilita CORS per tutte le rotte
app.use(express.json()); // Per parsare i body delle richieste in JSON
app.use(express.static(path.join(__dirname, 'public'))); // Serve il frontend

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
// --- [P.H.A.N.T.O.M. FASE 1] Endpoint di recupero analisi pre-generata ---
// =========================================================================
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
            res.status(200).json({ status: 'ready', data: cachedAnalysis });
        } else {
            console.log(`[Analysis-Endpoint] Cache MISS per ${cacheKey}. Il client dovrà usare lo streaming.`);
            // Il client riceve 'pending' e sa che deve avviare lo streaming come fallback.
            res.status(200).json({ status: 'pending' });
        }
    } catch (error) {
        console.error("[Analysis-Endpoint] Errore critico:", error.stack);
        res.status(500).json({ status: 'error', message: 'Errore interno nel server.' });
    }
});


// =========================================================================
// --- ENDPOINT PER L'ANALISI IA (CON DEBUG RAG/LLM) ---
// =========================================================================
app.post('/api/analyze-day', async (req, res) => {
    console.log(`[RAG-Request] Received request.`);
 
    try {
        const { lat, lon, userQuery } = req.body; 
        const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";

        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
        }
        
        // 1. [THE FIX] We get data from the CACHE, we don't re-fetch everything.
        // We build the same cache key that /api/forecast would use.
        const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`; // Match the key from forecast-logic.js
        
        let fullResponse = myCache.get(cacheKey);

        // If cache is empty (e.g., first ever load, or expired), we must fetch it.
        // This makes the endpoint robust.
        if (!fullResponse) {
            console.warn(`[RAG-Flow] Cache MISS for analysis. Forcing a data fetch for ${normalizedLocation}. This should be rare.`);
            fullResponse = await fetchAndProcessForecast(`${lat},${lon}`);
        }
        
        const forecastDataArray = fullResponse.forecast || [];
        
        const NOT_SPECIFIED = 'Informazione non disponibile'; 
        
        if (!forecastDataArray || forecastDataArray.length === 0) {
            console.error("[RAG-Flow] Dati forecast non disponibili per la posizione.");
            return res.status(500).json({ status: 'error', message: "Impossibile recuperare i dati meteo marini per l'analisi." });
        }

        const firstDay = forecastDataArray[0] || {}; 

        if (Object.keys(firstDay).length === 0) {
            console.error("[RAG-Flow] Struttura dati 'firstDay' vuota.");
            const defaultAnalysis = "### Analisi non disponibile\n---\nNon è stato possibile caricare i dati meteo-marini strutturati...";
            // [FIX] Respond with 'data' field for consistency
            return res.status(200).json({ status: 'success', data: defaultAnalysis });
        }
        
        const currentHourData = firstDay.hourly?.find(h => h.isCurrentHour) || firstDay.hourly?.[0] || {};

        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;

        // 2. [FIX] Single, unique declaration of weatherQuery
        const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');

        // 3. Robustness check for RAG
        const ALL_KEY_DATA_MISSING = [weatherDesc, mare, pressione, ventoDati].every(d => d === NOT_SPECIFIED);
        let knowledgeText;
        let relevantDocs = [];
        
        if (ALL_KEY_DATA_MISSING) {
            console.warn("[RAG-Flow] Dati meteo chiave assenti. Query Vector DB saltata.");
            knowledgeText = "CONTESTO MANCANTE: Non è stato possibile reperire i dati specifici...";
        } else {
            console.log(`[RAG-Flow] Generated query for Vector DB: "${weatherQuery}"`);
            relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
            knowledgeText = relevantDocs.length > 0 
                ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
                : "Nessun fatto specifico trovato...";
        }

        // 4. Debugging and Prompt Building (your logic is preserved)
        console.log(`\n--- [DEBUG-RAG] Output Database Vettoriale (${relevantDocs.length} Docs) ---`);
        console.log(knowledgeText);
        console.log('----------------------------------------------------');
        
        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.tempMinMax || 'N/A'}
            - Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
            - Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${(firstDay.currentHourData && firstDay.currentHourData.waterTemperature) || 'N/A'}C
            - Luna: ${firstDay.moonPhase || 'N/A'}, Maree: Alta ${firstDay.altaMarea || 'N/A'}, Bassa ${firstDay.bassaMarea || 'N/A'}
        `.trim();
        const prompt = `
            Sei Meteo Pesca AI, un esperto di pesca sportiva. Analizza i dati e i fatti pertinenti per dare un consiglio strategico in Italiano.

            --- ISTRUZIONI DI FORMATTAZIONE OBBLIGATORIE ---
            La tua risposta DEVE essere solo ed esclusivamente il testo dell'analisi, formattato in Markdown.
            - Usa '###' per i titoli.
            - Usa '*' per le liste puntate.
            - Evidenzia i concetti positivi con '**'.
            - Evidenzia gli avvertimenti con '~~'.
            - NON includere JSON, preamboli o altre spiegazioni al di fuori dell'analisi.

            --- DATI METEO-MARINI ---
            ${weatherTextForPrompt}
            --- FINE DATI ---

            --- FATTI RILEVANTI DALLA KNOWLEDGE BASE ---
            ${knowledgeText}
            --- FINE FATTI ---

            DOMANDA DELL'UTENTE: "${finalUserQuery}"

            Adesso, basandoti su tutto, genera l'analisi in Markdown.
        `.trim();

        // PUNTO 2: Stampa il prompt
        console.log('\n--- [DEBUG-PROMPT] Prompt Inviato all\'AI ---\n', prompt);

        // 6. Send to Gemini.
        const rawAiResponse = await generateAnalysis(prompt);

        // PUNTO 3: Stampa la risposta grezza
        console.log('\n--- [DEBUG-RESPONSE] Risposta Grezza AI ---\n', rawAiResponse);

        // 7. [ROBUST EXTRACTION] Manually extract the markdown content from the AI's JSON response.
        let analysisResult = '';
        try {
            const cleanedJsonText = rawAiResponse.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
            const parsedJson = JSON.parse(cleanedJsonText);
            if (parsedJson && parsedJson.analysis) {
                analysisResult = parsedJson.analysis;
                console.log('[Extraction] Successfully extracted "analysis" content from AI JSON.');
            } else {
                // Fallback if JSON is valid but has no 'analysis' field
                analysisResult = rawAiResponse;
            }
        } catch (e) {
            // If it's not JSON, assume the AI finally sent raw Markdown.
            analysisResult = rawAiResponse;
            console.log('[Extraction] Response was not JSON, assuming raw Markdown.');
        }

        // 8. Validate the extracted analysis string
        if (!analysisResult || analysisResult.trim().length < 50) {
            throw new Error("L'analisi estratta è vuota o insufficiente.");
        }
        
        // 9. Truncate if necessary (your logic)
        let finalAnalysis = analysisResult.trim();
        // ... (tua logica di troncamento se necessaria) ...

        // 10. Send the FINAL CLEANED markdown string in the 'data' field.
        const successResponse = {
            status: 'success',
            data: finalAnalysis,
        };
        console.log("[pesca-api] Sent 200 Success Response. Analysis length:", finalAnalysis.length);
        return res.status(200).json(successResponse);


    } catch (error) {
        console.error("[pesca-api] ERROR during RAG /api/analyze-day:", error.stack);
        let errorMessage = "Errore durante l'elaborazione dell'analisi AI.";
        if (error.message.includes("AI response was not valid structured JSON")) {
            errorMessage = "Errore di parsing interno...";
        }
        const errorResponse = { status: 'error', message: errorMessage };
        console.log("[pesca-api] Sent 500 Error Response (Catch Block):", JSON.stringify(errorResponse));
        return res.status(500).json(errorResponse);
    }
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/analyze-day`);
});
