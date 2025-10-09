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
// --- ENDPOINT PER L'ANALISI IA (Aggiunto controllo di robustezza) ---
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
        // Estraiamo l'oggetto completo e l'array dei giorni
        const fullResponse = await fetchAndProcessForecast(locationCoords);
        const forecastDataArray = fullResponse.forecast || [];
        
        // La stringa di fallback è esplicita per l'AI
        const NOT_SPECIFIED = 'Informazione non disponibile'; 
        
        if (!forecastDataArray || forecastDataArray.length === 0) {
            console.error("[RAG-Flow] Dati forecast non disponibili per la posizione.");
            return res.status(500).json({ status: 'error', message: "Impossibile recuperare i dati meteo marini per l'analisi." });
        }

        // Estraggo il primo giorno in modo esplicito e sicuro
        const firstDay = forecastDataArray[0] || {}; 
        
        if (Object.keys(firstDay).length === 0) {
            console.error("[RAG-Flow] Struttura dati 'firstDay' vuota. Impossibile procedere con l'analisi AI.");
            const defaultAnalysis = "### Analisi non disponibile\n---\nNon è stato possibile caricare i dati meteo-marini strutturati per la località selezionata. Questo potrebbe essere dovuto a un errore temporaneo nel servizio di aggregazione dei dati.\n\n**Consiglio:** Riprova tra qualche minuto o seleziona una località vicina. I dati relativi a Vento e Onde per il calcolo dello Score sono stati caricati, ma l'analisi dettagliata AI richiede più informazioni e sta avendo un problema di mappatura interna.";
            
            return res.status(200).json({
                status: 'success',
                analysis: defaultAnalysis, // Usiamo 'analysis' anche per il default
            });
        }
        // -------------------------------------------------------------
        
        // Estraggo i dati per l'ora corrente (o la prima ora)
        const currentHourData = firstDay.hourly && firstDay.hourly.length > 0 
            ? (firstDay.hourly.find(h => h.isCurrentHour) || firstDay.hourly[0] || {}) 
            : {};

        // --- ESTRAZIONE DATI CHIAVE PER RAG QUERY ---
        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;


        // 2. [RAG STEP] Create a query string from the most relevant weather data.
        const weatherQuery = `
          Condizioni generali: ${weatherDesc}. 
          Stato del mare: ${mare}. 
          Pressione: ${pressione}.
          Vento: ${ventoDati}.
        `.trim().replace(/\s+/g, ' ');

        // 3. --- CONTROLLO DI ROBUSTZZA RAG ---
        // Verifica se tutti i dati chiave sono mancanti.
        const ALL_KEY_DATA_MISSING = [weatherDesc, mare, pressione, ventoDati].every(
            data => data === NOT_SPECIFIED
        );

        let knowledgeText;
        if (ALL_KEY_DATA_MISSING) {
            console.warn("[RAG-Flow] Dati meteo chiave assenti. Query Vector DB saltata.");
            knowledgeText = "CONTESTO MANCANTE: Non è stato possibile reperire i dati specifici sul meteo (vento, mare, pressione) per la tua zona. L'analisi dovrà concentrarsi sui consigli di pesca basati solo sulle condizioni stagionali/lunari, e specificare che l'assenza di dati richiede cautela.";
        } else {
            // 3. [RAG STEP] Query the vector DB con i dati disponibili. 
            console.log(`[RAG-Flow] Generated query for Vector DB: "${weatherQuery}"`);
            const relevantDocs = await queryKnowledgeBase(weatherQuery, 2); 

            // Formatta i documenti recuperati
            knowledgeText = relevantDocs.length > 0 
                ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
                : "Nessun fatto specifico trovato, l'analisi si baserà sulla conoscenza generale e sui dati meteo disponibili.";
        }
        console.log(`[RAG-Flow] Retrieved knowledge:\n${knowledgeText}`);
        
        // 4. Prepare a clean weather summary for the AI prompt.
        const weatherTextForPrompt = `
Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
- Condizioni: ${weatherDesc}, Temp: ${firstDay.tempMinMax || 'N/A'}
- Vento: ${ventoDati}, Mare: ${mare}
- Pressione: ${pressione}, Acqua: ${currentHourData.waterTemperature || NOT_SPECIFIED}
- Luna: ${firstDay.moonPhase || NOT_SPECIFIED}, Maree: Alta ${firstDay.altaMarea || NOT_SPECIFIED}, Bassa ${firstDay.bassaMarea || NOT_SPECIFIED}
        `.trim();

        // 5. Build the final prompt with formatting instructions for JSON output
        const prompt = `
Sei Meteo Pesca AI, un esperto di pesca sportiva. Analizza i dati e i fatti pertinenti per dare un consiglio strategico.

--- ISTRUZIONI ---
Genera l'analisi **esclusivamente in un singolo oggetto JSON** con la seguente struttura: {"analysis": "TUA ANALISI QUI"}.
Il valore del campo 'analysis' deve contenere la tua analisi completa in Italiano, **massimo 1400 caratteri**, formattata in Markdown ('###', '*', '**'). Non includere testo, spiegazioni o preamboli al di fuori dell'oggetto JSON.

--- DATI METEO-MARINI ---
${weatherTextForPrompt}
--- FINE DATI ---

--- FATTI RILEVANTI DALLA KNOWLEDGE BASE / CONTESTO DI EMERGENZA ---
${knowledgeText}
--- FINE FATTI ---

In base all'analisi dei dati e dei fatti rilevanti, rispondi alla richiesta dell'utente: "${finalUserQuery}".
    `.trim();

        // 6. Send to Gemini for the final analysis (we assume it returns the JSON string)
        const analysisResultJsonText = await generateAnalysis(prompt);

        // 7. Parse the JSON result and extract the analysis string.
        let analysisResult = null;
        try {
            // FIX: Rimuoviamo i delimitatori del blocco codice Markdown (```json) prima del parsing
            const cleanedJsonText = analysisResultJsonText
                .replace(/```json\s*/g, '') // Rimuove ```json e spazi iniziali
                .replace(/\s*```/g, '') // Rimuove spazi finali e ```
                .trim();
            
            console.log(`[GeminiService] Cleaned JSON Text: ${cleanedJsonText}`);
            
            // Ora facciamo il parsing sulla stringa pulita
            const parsedJson = JSON.parse(cleanedJsonText);
            analysisResult = parsedJson.analysis;
        } catch (e) {
            console.error(`[GeminiService] Failed to parse JSON response: ${e.message}`, analysisResultJsonText);
            // Se il parsing fallisce, lanciamo un errore specifico.
            throw new Error("AI response was not valid structured JSON.");
        }

        // 8. Correzione: Verifichiamo che la risposta AI sia significativa
        if (!analysisResult || analysisResult.trim().length < 50) { 
            console.error(`[GeminiService] L'analisi è vuota o insufficiente (lunghezza: ${analysisResult ? analysisResult.trim().length : 0}). Controllare il prompt generato.`);
            
            // PREPARIAMO E LOGGIAMO LA RISPOSTA DI ERRORE DETTAGLIATA
            const errorResponse = {
                status: 'error', 
                message: "L'AI non ha potuto generare un'analisi significativa con i dati forniti. Riprova." 
            };
            console.log("[pesca-api] Sent 500 Error Response (Empty Analysis):", JSON.stringify(errorResponse));

            // Restituiamo un errore strutturato (status 500) per gestire l'errore lato client
            return res.status(500).json(errorResponse); 
        }

        // 9. TRUNCATURA DI SICUREZZA (Safety Net)
        let finalAnalysis = analysisResult.trim();
        const MAX_LENGTH = 3000; // <-- AUMENTATO IL LIMITE DI SICUREZZA
        
        console.log(`[GeminiService] Analysis generated successfully. Original Length: ${finalAnalysis.length}`); 

        if (finalAnalysis.length > MAX_LENGTH) {
            console.warn(`[GeminiService] WARNING: Analysis too long (${finalAnalysis.length}). Truncating to ${MAX_LENGTH} characters.`);
            // Aggiungiamo '...' se troncato.
            finalAnalysis = finalAnalysis.substring(0, MAX_LENGTH - 3) + '...';
        }


        // 10. Send back the response in the format the app expects ('analysis' field).
        const successResponse = {
            status: 'success',
            analysis: finalAnalysis, 
        };
        console.log("[pesca-api] Sent 200 Success Response. Analysis length:", finalAnalysis.length);

        return res.status(200).json(successResponse);
    } catch (error) {
        console.error("[pesca-api] ERROR during RAG /api/analyze-day:", error.stack);
        
        let errorMessage = "Errore durante l'elaborazione dell'analisi AI.";
        if (error.message.includes("AI response was not valid structured JSON")) {
            errorMessage = "Errore di parsing interno: la risposta dell'AI non era nel formato atteso.";
        }
        
        // PREPARIAMO E LOGGIAMO LA RISPOSTA DI ERRORE GENERICA
        const errorResponse = {
            status: 'error',
            message: errorMessage
        };
        console.log("[pesca-api] Sent 500 Error Response (Catch Block):", JSON.stringify(errorResponse));

        return res.status(500).json(errorResponse);
    }
});
// --- FINE ENDPOINT AGGIORNATO ---


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Endpoint RAG ATTIVO: POST http://localhost:${PORT}/api/analyze-day`);
});
