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
const { fetchAndProcessForecast, myCache } = require('./lib/forecast-logic.js'); 
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
// --- [FINAL RAG IMPLEMENTATION - BUGFIXED hourly access] ENDPOINT PER L'ANALISI IA ---
// =========================================================================
app.post('/api/analyze-day', async (req, res) => {
    console.log(`[pesca-api] [${new Date().toISOString()}] Received RAG request.`);
 
    try {
        const { lat, lon, userQuery } = req.body; 
        const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";

        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
        }
        
        // 1. Fetch real weather data
        const locationCoords = `${lat},${lon}`;
        const forecastDataArray = await fetchAndProcessForecast(locationCoords);
        
        if (!forecastDataArray || forecastDataArray.length === 0) {
            // Se non ci sono dati, solleviamo un errore esplicito
            console.error("[RAG-Flow] Dati forecast non disponibili per la posizione.");
            return res.status(500).json({ status: 'error', message: "Impossibile recuperare i dati meteo marini per l'analisi." });
        }

        const firstDay = forecastDataArray[0] || {}; // [BUGFIX CRITICO] Assicuriamo che firstDay sia almeno un oggetto vuoto
        
        // [BUGFIX CRITICO] Assicuriamo che 'hourly' esista prima di leggerlo
        const currentHourData = firstDay.hourly && firstDay.hourly.length > 0 
            ? (firstDay.hourly.find(h => h.isCurrentHour) || firstDay.hourly[0] || {}) 
            : {};


        // 2. [RAG STEP] Create a query string from the most relevant weather data.
        const weatherQuery = `
          Condizioni generali: ${firstDay.weatherDesc || ''}. 
          Stato del mare: ${firstDay.mare || ''}. 
          Pressione: ${firstDay.pressione || ''}.
          Vento: ${firstDay.ventoDati || ''}.
        `.trim().replace(/\s+/g, ' ');

        console.log(`[RAG-Flow] Generated query for Vector DB: "${weatherQuery}"`);

        // 3. [RAG STEP] Query the vector DB. 
        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2); 

        // Format the retrieved documents
        const knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato, basati sulla conoscenza generale.";
        
        console.log(`[RAG-Flow] Retrieved knowledge:\n${knowledgeText}`);
        
        // 4. Prepare a clean weather summary for the AI prompt.
        const weatherTextForPrompt = `
Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
- Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.tempMinMax || 'N/A'}
- Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
- Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${currentHourData.waterTemperature || 'N/A'}C
- Luna: ${firstDay.moonPhase || 'N/A'}, Maree: Alta ${firstDay.altaMarea || 'N/A'}, Bassa ${firstDay.bassaMarea || 'N/A'}
        `.trim();

        // 5. Build the final prompt with formatting instructions
        const prompt = `
Sei Meteo Pesca AI, un esperto di pesca sportiva. Analizza i dati e i fatti pertinenti per dare un consiglio strategico.

--- ISTRUZIONI DI FORMATTAZIONE ---
Usa Markdown: '###' per i titoli, '---' per i separatori, '*' per le liste, '**' per highlight positivi e '~~' per avvertimenti.

--- DATI METEO-MARINI ---
${weatherTextForPrompt}
--- FINE DATI ---

--- FATTI RILEVANTI DALLA KNOWLEDGE BASE ---
${knowledgeText}
--- FINE FATTI ---

In base all'analisi dei dati e dei fatti rilevanti, rispondi alla richiesta dell'utente: "${finalUserQuery}".
    `.trim();

        // 6. Send to Gemini for the final analysis
        const analysisResult = await generateAnalysis(prompt);

        // 7. Send back the response in the format the app expects ('data' field).
        return res.status(200).json({
            status: 'success',
            data: analysisResult, 
        });

    } catch (error) {
        console.error("[pesca-api] ERROR during RAG /api/analyze-day:", error.stack);
        return res.status(500).json({
            status: 'error',
            message: "Errore durante l'elaborazione dell'analisi AI."
        });
    }
});
// --- FINE ENDPOINT AGGIORNATO ---


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/analyze-day`);
});
