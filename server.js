// server.js
const express = require('express');
const path = require('path');
const cors = require('cors'); // CORS middleware for handling cross-origin requests

// Ensure our logic is correctly imported
const { fetchAndProcessForecast, myCache } = require('./lib/forecast-logic.js'); 
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARE ---
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // To parse JSON request bodies
app.use(express.static(path.join(__dirname, 'public'))); // Serve the frontend

// --- HEALTH CHECK ROUTE ---
app.get('/', (req, res) => {
  res.status(200).send('Pesca API Server is running!');
});

// --- API ROUTES ---
// All routes will start with /api
app.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || '40.813238367880984,14.208944303204635';
        
        // The fetch logic has been simplified and made more robust
        const forecastData = await fetchAndProcessForecast(location);

        // --- FINAL DEBUG BLOCK ---
        // This try...catch will isolate any issue that occurs ONLY
        // when the server attempts to convert the final object to a JSON string.
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
        // fetchAndProcessForecast already handles cache saving
        await fetchAndProcessForecast(locationToUpdate); 
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON JOB] Error during update:", error.message);
        return res.status(500).json({ status: 'error' });
    }
});

// The two routes that were previously in separate files are now handled directly here for simplicity
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);

// [POC - RAG FEATURE] Endpoint for AI-driven analysis
// Simulates a 2.5 second delay to mimic LLM processing time
app.post('/api/analyze-day', (req, res) => {
  console.log(`[pesca-api] [${new Date().toISOString()}] Received request for /api/analyze-day`);

  setTimeout(() => {
    const analysisResponse = {
      "analysis": "Analisi per domani: Le condizioni sono eccellenti per la pesca alla spigola da riva. Il mare in scaduta, unito alla pressione in calo, aumenterà l'attività dei predatori nelle prime ore del mattino. Evita la traina, il vento da nord-est renderà il mare troppo mosso al largo."
    };
    console.log('[pesca-api] Sending analysis response.');
    res.status(200).json(analysisResponse);
  }, 2500); // 2.5-second delay
});

// --- START THE SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});