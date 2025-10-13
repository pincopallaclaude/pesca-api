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
const cors = require('cors'); // CORS middleware for handling cross-origin requestss

// Assicuriamoci di importare correttamente le nostre logiche
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js'); // Ora importa solo quello che serve 
const { myCache, analysisCache } = require('./lib/utils/cache.manager.js'); // Importa ENTRAMBE le cache
const { generateAnalysis } = require('./lib/services/gemini.service.js'); // Funzione per la chiamata a Gemini
const { queryKnowledgeBase } = require('./lib/services/vector.service.js'); // Import RAG corretto
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');
const { runDataPipeline } = require('./tools/data-pipeline.js');

const app = express();
// Usiamo la porta definita nel file essistente:
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
// --- [PHANTOM] ENDPOINT A LATENZA ZERO (PRIMARIO) ---
// =========================================================================
app.post('/api/get-analysis', (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) {
        return res.status(400).json({ status: 'error', message: 'Lat/Lon richiesti.' });
    }

    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const cacheKey = `analysis-v1-${normalizedLocation}`;
    
    const cachedAnalysis = analysisCache.get(cacheKey);

    if (cachedAnalysis) {
        console.log(`[Phantom-API] ✅ Cache HIT per analisi ${normalizedLocation}. Risposta istantanea.`);
        // Lo stato 'ready' dice al client che l'analisi è pronta e la invia
        res.status(200).json(cachedAnalysis);
    } else {
        console.log(`[Phantom-API] ⏳ Cache MISS per analisi ${normalizedLocation}. Il client userà il fallback.`);
        // Lo stato 'pending' dice al client di chiamare l'endpoint di fallback
        res.status(202).json({ status: 'pending' }); 
    }
});


// =========================================================================
// --- [FALLBACK] ENDPOINT ON-DEMAND (usato solo in caso di cache miss) ---
// =========================================================================
app.post('/api/analyze-day-fallback', async (req, res) => {
    console.log(`[RAG-Fallback] Received on-demand request.`);
 
    try {
        const { lat, lon, userQuery } = req.body; 
        const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";

        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
        }
        
        const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`;
        
        // La logica torna a essere "server-first": controlla la cache e, se manca, fa il fetch.
        let fullResponse = myCache.get(cacheKey);

        if (!fullResponse) {
            console.warn(`[RAG-Fallback] Cache MISS for forecast data. Forcing fetch for ${normalizedLocation}.`);
            fullResponse = await fetchAndProcessForecast(`${lat},${lon}`);
        } else {
            console.log('[RAG-Fallback] Cache HIT for forecast data. Proceeding directly to analysis.');
        }
        
        const forecastDataArray = fullResponse.forecast || [];
        const NOT_SPECIFIED = 'Informazione non disponibile'; 
        
        if (!forecastDataArray || forecastDataArray.length === 0) {
            return res.status(500).json({ status: 'error', message: "Impossibile recuperare i dati meteo marini per l'analisi." });
        }

        const firstDay = forecastDataArray[0] || {}; 

        if (Object.keys(firstDay).length === 0) {
            const defaultAnalysis = "### Analisi non disponibile\n---\nNon è stato possibile caricare i dati meteo-marini strutturati...";
            return res.status(200).json({ status: 'success', data: defaultAnalysis });
        }
        
        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;

        const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');

        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        const knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato...";

        // Debugging and Prompt Building
        console.log(`\n--- [DEBUG-RAG] Output Database Vettoriale (${relevantDocs.length} Docs) ---`);
        console.log(knowledgeText);
        console.log('----------------------------------------------------');
            

        const waterTemp = (firstDay.hourly && firstDay.hourly[0] && firstDay.hourly[0].waterTemperature !== undefined) 
            ? `${firstDay.hourly[0].waterTemperature}°C`
            : 'N/A';

        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.temperaturaMin}°-${firstDay.temperaturaMax}°C
            - Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
            - Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${waterTemp}
            - Luna: ${firstDay.moonPhase || 'N/A'}, Maree: ${firstDay.maree || 'N/A'}
        `.trim().replace(/^\s+/gm, '');

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

        const rawAiResponse = await generateAnalysis(prompt);

        // PUNTO 3: Stampa la risposta grezza
        console.log('\n--- [DEBUG-RESPONSE] Risposta Grezza AI ---\n', rawAiResponse);

        let finalAnalysis = rawAiResponse;
        try {
            const cleanedJsonText = rawAiResponse.replace(/^```json\s*/, '').replace(/```$/, '').trim();
            const parsedJson = JSON.parse(cleanedJsonText);
            // Cerca la prima chiave che contiene "analisi" o "analysis"
            const analysisKey = Object.keys(parsedJson).find(key => key.toLowerCase().includes('analisi') || key.toLowerCase().includes('analysis'));

            if (analysisKey) {
                finalAnalysis = parsedJson[analysisKey];
            } else {
                finalAnalysis = rawAiResponse;
            }
        } catch (e) {
            // Se non è JSON, assumiamo sia Markdown grezzo, va bene.
        }

        if (!finalAnalysis || finalAnalysis.trim().length < 50) {
            throw new Error("L'analisi estratta è vuota o insufficiente.");
        }
        
        const successResponse = {
            status: 'success',
            data: finalAnalysis.trim(),
        };
        const analysisCacheKey = `analysis-v1-${normalizedLocation}`; // Usa un nome diverso per non confliggere
        analysisCache.set(analysisCacheKey, successResponse);
        console.log("[RAG-Fallback] Analysis cached for future requests.");
                
        console.log("[RAG-Fallback] Sent 200 Success Response. Analysis length:", finalAnalysis.trim().length);
        return res.status(200).json(successResponse);

    } catch (error) {
        console.error("[RAG-Fallback] ERROR during on-demand analysis:", error.stack);
        const errorResponse = { status: 'error', message: "Errore durante l'elaborazione dell'analisi AI." };
        return res.status(500).json(errorResponse);
    }
});


// --- AVVIO DEL SERVER ---
async function startServer() {
    console.log('[SERVER STARTUP] Populating vector database...');
    await runDataPipeline();
    console.log('[SERVER STARTUP] Vector database populated.');
    
    app.listen(PORT, () => {
        console.log(`Server listening on port ${PORT}`);
        console.log(`Endpoint PHANTOM ATTIVO: POST http://localhost:${PORT}/api/get-analysis`);
        console.log(`Endpoint FALLBACK ATTIVO: POST http://localhost:${PORT}/api/analyze-day-fallback`);
    });
}

startServer();
