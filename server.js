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
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

// --- NUOVA IMPORTAZIONE RAG ---
const { getFishingAdvice } = require('./lib/services/gemini.service');
// -----------------------------

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
// --- [RAG FEATURE] ENDPOINT PER L'ANALISI IA (SOSTITUISCE IL MOCK) ---
// =========================================================================
app.post('/api/analyze-day', async (req, res) => {
    console.log(`[Server] Ricevuta richiesta RAG per /api/analyze-day`);

    // Estrae i dati dal corpo della richiesta POST, usando i valori di default
    const { 
        location = "Foce del Tevere", 
        date = new Date().toISOString().split('T')[0], 
        userQuery = "Qual è la strategia vincente per oggi?" 
    } = req.body;

    try {
        // Chiama il servizio Gemini che esegue il flusso RAG completo
        const advice = await getFishingAdvice(userQuery, location, date);
        
        // Risposta strutturata conforme all'obiettivo (un oggetto JSON contenente l'analisi)
        res.status(200).json({
            analysis: advice // Usiamo la chiave 'analysis' come nel tuo mock precedente
        });

    } catch (error) {
        console.error(`[Server] Errore nell'analisi AI: ${error.message}`);
        // Restituisce l'errore in caso di fallimento della chiamata a Gemini
        res.status(500).json({
            status: "error",
            message: "Errore durante la generazione del consiglio di pesca dall'AI."
        });
    }
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/analyze-day`);
});