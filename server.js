// server.js

// Load environment variables
require('dotenv').config();

// --- NUOVO BLOCCO DI VERIFICA ---
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
const { getKnowledgeFor } = require('./lib/domain/knowledge_base.js'); // Funzione per la Knowledge Base
const { generateAnalysis } = require('./lib/services/gemini.service.js'); // Funzione per la chiamata a Gemini
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
    // ... (Logica esistente per /api/forecast)
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
    // ... (Logica esistente per /api/update-cache)
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

// Le due rotte che prima erano in file separati sono ora gestite direttamente qui per semplicità
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);


// =========================================================================
// --- [RAG FEATURE] ENDPOINT PER L'ANALISI IA (AGGIORNATO CON DATI REALI) ---
// =========================================================================
app.post('/api/analyze-day', async (req, res) => {
    console.log(`[pesca-api] [${new Date().toISOString()}] Received RAG request for /api/analyze-day`);

    try {
        // 1. Get real coordinates from the app's request body
        // La userQuery viene passata dall'app per personalizzare la richiesta all'AI
        const { lat, lon, userQuery } = req.body;
        
        if (!lat || !lon) {
            return res.status(400).json({ status: 'error', message: 'Latitude and longitude are required.' });
        }
        // userQuery è opzionale, ma utile per personalizzare il consiglio (es. "Voglio pescare Spigole")
        const finalUserQuery = userQuery || "Qual è il miglior momento per pescare oggi?";

        // 2. Fetch the complete, real weather forecast data
        const locationCoords = `${lat},${lon}`;
        // La funzione restituisce { locationName, forecast: [giorno1, giorno2, ...] }
        const { locationName, forecast } = await fetchAndProcessForecast(locationCoords);

        // Analizziamo il primo giorno (oggi) del forecast
        const firstDay = forecast[0]; 
        const currentHourData = firstDay.hourly.find(h => h.isCurrentHour) || firstDay.hourly[0];


        // 3. Extract key metrics to build a rich context for the AI
        const weatherText = `
Dati Meteo-Marini per ${locationName} (${firstDay.giornoData} - Ora: ${currentHourData.ora}):
- Condizioni Generali: ${currentHourData.weatherDesc}
- Temperatura Aria: Min ${firstDay.temperaturaMin} C, Max ${firstDay.temperaturaMax} C (Media: ${firstDay.temperaturaAvg} C)
- Vento: ${firstDay.ventoDati}
- Stato Mare (Onde/Corrente): ${firstDay.mare}
- Pressione: ${currentHourData.pressione} hPa
- Temperatura Acqua: ${currentHourData.waterTemperature || 'N/A'} C
- Fase Lunare: ${firstDay.moonPhase}
- Indice Pesca Orario (Score): ${currentHourData.pescaScore} / 100
- Maree: ${firstDay.maree}
        `.trim();

        // 4. Get knowledge base context (passando i parametri che potrebbero influenzare le "Regole d'Oro" se implementassimo una logica selettiva)
        const knowledgeText = getKnowledgeFor({ locationName, moonPhase: firstDay.moonPhase });

        // 5. Build the final, dynamic prompt
        const prompt = `
Sei l'Meteo Pesca AI, un esperto di pesca sportiva. Il tuo compito è analizzare in modo critico i dati meteo-marini in base alle regole d'oro fornite, e fornire una sintesi concisa e un consiglio operativo per l'utente.

--- DATI METEO-MARINI ---
${weatherText}
--- FINE DATI ---
--- REGOLE D'ORO (Knowledge Base) ---
${knowledgeText}
--- FINE REGOLE ---

In base all'analisi dei dati e delle regole:
1. Sintetizza i **3 fattori più importanti** che influenzano la pesca oggi.
2. Fornisci un **consiglio pratico** (esche/tecniche/orario) in risposta alla richiesta dell'utente: "${finalUserQuery}".
3. Usa un tono da esperto e motivato.
        `.trim();
        
        // console.log("DEBUG: Final Prompt sent to Gemini:\n", prompt);

        // 6. Send to Gemini for analysis
        const analysisResult = await generateAnalysis(prompt);

        // 7. Return the AI-generated response
        // La risposta viene incapsulata in 'analysis' per l'app frontend
        return res.status(200).json({
            status: 'success',
            analysis: analysisResult,
        });

    } catch (error) {
        console.error("[pesca-api] ERROR during /api/analyze-day:", error);
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
