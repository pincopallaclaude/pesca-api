// server.js
const express = require('express');
const path = require('path');
const cors = require('cors'); // CORS middleware for handling cross-origin requests

// Assicuriamoci di importare correttamente le nostre logiche
const { fetchAndProcessForecast, myCache } = require('./lib/forecast-logic.js'); 
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

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

// --- ROUTES API ---
// Tutte le rotte inizieranno con /api
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

// Le due rotte che prima erano in file separati sono ora gestite direttamente qui per semplicità
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);


// =========================================================================
// --- [POC - RAG FEATURE] ENDPOINT PER L'ANALISI IA ---
// Questo endpoint simula una chiamata a un LLM con un ritardo di 2.5 secondi
// =========================================================================
app.post('/api/analyze-day', (req, res) => {
  console.log(`[pesca-api] [${new Date().toISOString()}] Received request for /api/analyze-day`);

  setTimeout(() => {
    const analysisResponse = {
      "analysis": "Analisi per domani: Le condizioni sono **eccellenti** per la pesca alla **spigola da riva**. Il mare in *scaduta*, unito alla pressione in *calo*, aumenterà l'attività dei predatori nelle *prime ore del mattino*. ##Evita la traina##, il vento da nord-est renderà il mare troppo mosso al largo."
    };
    console.log('[pesca-api] Sending analysis response.');
    res.status(200).json(analysisResponse);
  }, 2500); // Ritardo di 2.5 secondi per simulare il processing
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});