// server.js

import express from 'express';
import cors from 'cors';
import 'dotenv/config';

// Moduli core e servizi
import { fetchAndProcessForecast, POSILLIPO_COORDS } from './lib/forecast-logic.js';
import { analysisCache } from './lib/utils/cache.manager.js';
import { loadKnowledgeBaseFromFile } from './lib/services/vector.service.js';
import { mcpClient } from './lib/services/mcp-client.service.js';

// Handler API
import autocompleteHandler from './api/autocomplete.js';
import reverseGeocodeModule from './api/reverse-geocode.js';
import analyzeDayFallbackModule from './api/analyze-day-fallback.js';
import queryNaturalLanguage from './api/query-natural-language.js';
import recommendSpecies from './api/recommend-species.js';

console.log('--- [SERVER BOOT] Moduli caricati in memoria ---');

const app = express();
const PORT = process.env.PORT || 8080;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES ---

// Route di controllo "Sono vivo?"
app.get('/', (req, res) => res.status(200).send('Pesca API Server is running!'));

// Route per il controllo di stato e la connettività MCP
app.get('/health', (req, res) => {
    const mcpStatus = mcpClient.connected ? 'connected' : 'disconnected';
    res.json({ status: 'ok', mcp: mcpStatus, timestamp: new Date().toISOString() });
});

// Route principale per i dati meteo
app.get('/api/forecast', async (req, res) => {
    try {
        const location = req.query.location || POSILLIPO_COORDS;
        const forecastData = await fetchAndProcessForecast(location);
        res.json(forecastData);
    } catch (error) {
        console.error("[Server Error] /api/forecast:", error.message);
        res.status(500).json({ message: "Error getting forecast data." });
    }
});

// Route per l'autocomplete e il reverse geocoding
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeModule);

// Route per l'aggiornamento forzato della cache (Cron Job)
app.get('/api/update-cache', async (req, res) => {
    const secret = req.query.secret;
    if (secret !== process.env.CRON_SECRET_KEY) {
        console.warn('[CRON JOB] Tentativo di accesso non autorizzato a /api/update-cache');
        return res.status(401).json({ message: 'Unauthorized' });
    }
    try {
        // Aggiorna i dati per la posizione di default (Posillipo)
        await fetchAndProcessForecast(POSILLIPO_COORDS); 
        console.log('[CRON JOB] ✅ Cache di Posillipo aggiornata con successo.');
        return res.status(200).json({ status: 'ok', message: 'Cache aggiornata' });
    } catch (error) {
        console.error("[CRON JOB] ❌ Errore durante l'aggiornamento della cache:", error.message);
        return res.status(500).json({ status: 'error', message: error.message });
    }
});


// =========================================================================
// --- [PHANTOM] ENDPOINT A LATENZA ZERO (PRIMARIO) ---
// =========================================================================
app.post('/api/get-analysis', async (req, res) => {
    try {
        const { lat, lon } = req.body;
        if (!lat || !lon) return res.status(400).json({ error: 'Coordinate mancanti' });
        
        // Chiave di cache con precisione fissa
        const cacheKey = `${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}`;
        const cachedData = analysisCache.get(cacheKey);
        
        if (cachedData) {
            console.log(`[Phantom-API] ✅ Cache HIT per ${cacheKey}. Risposta istantanea.`);
            const isNewFormat = typeof cachedData === 'object' && cachedData.analysis;
            
            // Estrae l'analisi e i metadati in base al formato
            const analysisResult = isNewFormat ? cachedData.analysis : cachedData;
            const metadata = isNewFormat ? {
                locationName: cachedData.locationName,
                modelUsed: cachedData.modelUsed,
                modelProvider: cachedData.modelProvider,
                complexityLevel: cachedData.complexityLevel,
                generatedAt: cachedData.generatedAt,
                timingMs: cachedData.timingMs,
            } : null;
            
            res.json({
                status: 'ready',
                analysis: analysisResult,
                metadata: metadata,
            });
        } else {
            console.log(`[Phantom-API] ⏳ Cache MISS per ${cacheKey}. Il client userà il fallback.`);
            // Risposta 202 (Accepted) per indicare che l'elaborazione è iniziata/attesa dal client
            res.status(202).json({ status: 'pending', message: 'Analisi in elaborazione...' });
        }
    } catch (error) {
        console.error('[GET Analysis] ❌ Errore:', error);
        res.status(500).json({ error: 'Errore recupero analisi' });
    }
});

// Endpoint on-demand (Fallback)
app.post('/api/analyze-day-fallback', analyzeDayFallbackModule);

// Advanced AI Features (RAG e Raccomandazioni)
app.post('/api/query', queryNaturalLanguage);
app.post('/api/recommend-species', recommendSpecies);

// --- FUNZIONE DI AVVIO ORCHESTRATO ---
async function startServer() {
    try {
        console.log('[SERVER STARTUP] 🚀 Inizializzazione...');
        
        // 1. Validazione environment
        if (!process.env.GEMINI_API_KEY) {
            throw new Error("FATAL ERROR: GEMINI_API_KEY not found!");
        }

        // 2. Carica la KB e costruisce l'indice. Operazione bloccante.
        console.log('[SERVER STARTUP] 📖 Caricamento knowledge base e costruzione indice...');
        await loadKnowledgeBaseFromFile();
        console.log('[SERVER STARTUP] ✅ Indice KB pronto.');

        // 3. Connetti il client MCP.
        console.log('[SERVER STARTUP] 🔌 Connessione MCP client...');
        await mcpClient.connect();
        console.log('[SERVER STARTUP] ✅ MCP client connesso.');

        // 4. SOLO ORA, avvia il server Express per accettare richieste.
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`[SERVER STARTUP] 🎣 Server pronto su host 0.0.0.0, porta ${PORT}`);
            console.log(`[SERVER STARTUP] 🤖 Sistema MCP-Enhanced attivo`);
        });

    } catch (error) {
        console.error('--- [FATAL STARTUP CRASH] Errore durante l\'avvio ---');
        console.error(error);
        process.exit(1);
    }
}

// Gestione dello shutdown per chiudere correttamente la connessione MCP
process.on('SIGTERM', async () => {
    console.log('📴 SIGTERM ricevuto, shutdown graceful...');
    await mcpClient.disconnect();
    process.exit(0);
});

// Avvia il server
startServer();
