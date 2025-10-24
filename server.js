// server.js

// Load environment variables 
import 'dotenv/config'; // Usa il nuovo standard ES Module per caricare le variabili d'ambiente
import express from 'express';
import cors from 'cors';
import path from 'path'; // Mantenuto per coerenza, anche se non strettamente usato per static files
import { fileURLToPath } from 'url'; // Necessario per __dirname se fosse usato per path assoluti

// Servizi e logiche
import { fetchAndProcessForecast } from './lib/forecast-logic.js';
import { myCache, analysisCache } from './lib/utils/cache.manager.js';
import { loadKnowledgeBaseFromFile } from './lib/services/vector.service.js'; // Ancora necessario per pre-caricare il DB

// Handler API
import autocompleteHandler from './api/autocomplete.js';
import * as reverseGeocodeModule from './api/reverse-geocode.js'; // Importato come namespace
import * as analyzeDayFallbackModule from './api/analyze-day-fallback.js'; // Assunto anche questo come namespace
import { mcpClient } from './lib/services/mcp-client.service.js'; // <-- Nuovo MCP CLIENT

// Validazione environment
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY not found!");
    // In un ambiente che usa MCP, la chiave Gemini è ancora necessaria
    // a meno che MCP non gestisca tutto il routing. Manteniamo il check per sicurezza.
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;

// --- MIDDLEWARE ---
app.use(cors()); // Abilita CORS per tutte le rotte
app.use(express.json()); // Per parsare i body delle richieste in JSON

// --- ROUTES ---

// Route di controllo "Sono vivo?"
app.get('/', (req, res) => res.status(200).send('Pesca API Server is running!'));

// Route per il controllo di stato e la connettività MCP
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        mcp: mcpClient.connected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// Route principale per i dati meteo
app.get('/api/forecast', async (req, res) => {
    try {
        // Uso la versione normalizzata come default:
        const location = req.query.location || '40.813,14.208';
        const forecastData = await fetchAndProcessForecast(location);
        res.json(forecastData);
    } catch (error) {
        console.error("[Server Error] /api/forecast:", error.message, error.stack);
        res.status(500).json({ message: "Error getting forecast data.", error: error.message });
    }
});

// Route per l'aggiornamento forzato della cache
app.get('/api/update-cache', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.CRON_SECRET_KEY) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        // Aggiorna la cache per la località di Napoli (o default)
        await fetchAndProcessForecast('40.813,14.208');
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON JOB] Error during update:", error.message);
        return res.status(500).json({ status: 'error' });
    }
});

// Route per l'autocomplete e il reverse geocoding
app.get('/api/autocomplete', autocompleteHandler);

// CORREZIONE: Usare .default perché reverse-geocode.js usa export default
// Questo risolve "argument handler must be a function"
app.get('/api/reverse-geocode', reverseGeocodeModule.default);


// =========================================================================
// --- [PHANTOM] ENDPOINT A LATENZA ZERO (PRIMARIO) - Invariato ---
// =========================================================================
app.post('/api/get-analysis', (req, res) => {
    const { lat, lon } = req.body;
    if (!lat || !lon) return res.status(400).json({ status: 'error', message: 'Lat/Lon richiesti.' });
    
    const normalizedLocation = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
    const cacheKey = `analysis-v1-${normalizedLocation}`;
    
    const cached = analysisCache.get(cacheKey);
    if (cached) {
        console.log(`[Phantom-API] ✅ Cache HIT per analisi ${normalizedLocation}. Risposta istantanea.`);
        return res.status(200).json(cached); 
    }
    
    console.log(`[Phantom-API] ⏳ Cache MISS per analisi ${normalizedLocation}. Il client userà il fallback.`);
    return res.status(202).json({ status: 'pending' });
});


// =========================================================================
// --- [FALLBACK] ENDPOINT ON-DEMAND - ORA USA MCP ---
// =========================================================================
// CORREZIONE: Assumiamo che analyzeDayFallbackHandler usi anch'esso export default
app.post('/api/analyze-day-fallback', analyzeDayFallbackModule.default);


// --- AVVIO E SHUTDOWN ---
async function startServer() {
    try {
        console.log('[SERVER STARTUP] 🚀 Inizializzazione...');
        
        // Step 1: Carica Vector DB PRIMA (il server MCP ne ha bisogno)
        console.log('[SERVER STARTUP] 📖 Caricamento knowledge base...');
        await loadKnowledgeBaseFromFile();
        console.log('[SERVER STARTUP] ✅ Knowledge base caricata');
        
        // Step 2: Connette client MCP
        console.log('[SERVER STARTUP] 🔌 Connessione MCP client...');
        await mcpClient.connect();
        console.log('[SERVER STARTUP] ✅ MCP client connesso');
    
        // Step 3: Avvia Express
        app.listen(PORT, '0.0.0.0', () => { 
          console.log(`[SERVER STARTUP] 🎣 Server pronto su porta ${PORT}`);
          console.log(`[SERVER STARTUP] 🤖 Sistema MCP-Enhanced attivo`);
        });
        
    } catch (error) {
        console.error('[FATAL STARTUP CRASH]', error);
        process.exit(1);
    }
}

// Gestione dello shutdown per chiudere correttamente la connessione MCP
process.on('SIGTERM', async () => {
    console.log('📴 SIGTERM ricevuto, shutdown graceful...');
    await mcpClient.disconnect();
    process.exit(0);
});

// Gestione dell'errore di avvio
startServer();
