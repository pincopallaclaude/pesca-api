// server.js

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import * as logger from './lib/utils/logger.js';

console.log('--- [SERVER BOOT] Entry point server.js caricato ---');
console.log('[SERVER BOOT] 📦 Tentativo di avvio rapido...');

// --- DEFINISCI L'APP E L'HEALTH CHECK IMMEDIATO ---
const app = express();
app.use(cors());
app.use(express.json());

// Inizializza una variabile per tenere traccia dello stato di prontezza dei servizi critici
let servicesReady = false; 
const CRITICAL_SERVICES = ['ChromaDB', 'MCP'];
const serviceStatus = { ChromaDB: 'initializing', MCP: 'initializing' };


// Health check primario: risponde subito con 200/ok a Render/Kubernetes
app.get('/health', (req, res) => {
    // Risponde con 503 se i servizi critici non sono ancora pronti
    if (!servicesReady) {
        logger.warn('[HEALTH] Server non completamente pronto, restituisco 503.');
        return res.status(503).json({ 
            status: 'initializing', 
            message: 'Attendo l\'inizializzazione dei servizi critici (ChromaDB, MCP).',
            details: serviceStatus,
            timestamp: new Date().toISOString() 
        });
    }

    res.json({ status: 'ok', message: 'Servizi critici pronti.', details: serviceStatus, timestamp: new Date().toISOString() });
});

// Import asincroni e avvio principale
async function start() {
    try {
        if (!process.env.GEMINI_API_KEY) {
            console.error("FATAL ERROR: GEMINI_API_KEY not found!");
            process.exit(1);
        }

        // Importazioni di moduli core e servizi
        const { fetchAndProcessForecast, POSILLIPO_COORDS } = await import('./lib/forecast-logic.js');
        const { analysisCache } = await import('./lib/utils/cache.manager.js');
        const { initializeChromaDB } = await import('./lib/services/chromadb.service.js');
        const { mcpClient } = await import('./lib/services/mcp-client.service.js');
        
        // Handler API
        const { default: autocompleteHandler } = await import('./api/autocomplete.js');
        const { default: reverseGeocodeModule } = await import('./api/reverse-geocode.js');
        const { default: analyzeDayFallbackModule } = await import('./api/analyze-day-fallback.js');
        const { default: queryNaturalLanguage } = await import('./api/query-natural-language.js');
        const { default: recommendSpecies } = await import('./api/recommend-species.js');
        
        console.log('--- [SERVER BOOT] Moduli principali importati ---');

        // --- INIZIALIZZAZIONE DEI SERVIZI IN BACKGROUND (Non-Blocking) ---
        
        // 1. Inizializzazione ChromaDB (potrebbe richiedere tempo o retry)
        initializeChromaDB()
            .then(() => {
                serviceStatus.ChromaDB = 'ready';
                logger.log("[BACKGROUND] ✅ ChromaDB pronto.");
                checkServicesReady();
            })
            .catch(err => {
                serviceStatus.ChromaDB = 'failed';
                logger.error("[BACKGROUND] ❌ Inizializzazione ChromaDB fallita:", err.message);
            });

        // 2. Connessione MCP client (Ora è un mock locale e quasi istantaneo)
        mcpClient.connect()
            .then(() => {
                serviceStatus.MCP = 'ready';
                // Logger più conciso dato che non si aspetta un avvio di processo
                logger.log("[BACKGROUND] ✅ MCP Mock client connesso.");
                checkServicesReady();
            })
            .catch(err => {
                serviceStatus.MCP = 'failed';
                logger.error("[BACKGROUND] ❌ Connessione MCP client fallita (Mock):", err.message);
            });

        function checkServicesReady() {
            if (serviceStatus.ChromaDB === 'ready' && serviceStatus.MCP === 'ready') {
                servicesReady = true;
                logger.log('[SERVER STARTUP] 🏁 Tutti i servizi critici sono ora pronti.');
            }
        }
        
        // --- ROUTES DELL'APPLICAZIONE (che dipendono dai servizi) ---
        
        // Route di controllo
        app.get('/', (req, res) => res.status(200).send('Pesca API Server is running!'));

        // Route principale per i dati meteo
        app.get('/api/forecast', async (req, res) => {
            if (!servicesReady) return res.status(503).json({ message: "Servizi non pronti, attendere." });
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
            if (!servicesReady) return res.status(503).json({ message: "Servizi non pronti, attendere." });

            try {
                const { lat, lon } = req.body;
                if (!lat || !lon) return res.status(400).json({ error: 'Coordinate mancanti' });
                
                const cacheKey = `${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}`;
                const cachedData = analysisCache.get(cacheKey);
                
                if (cachedData) {
                    console.log(`[Phantom-API] ✅ Cache HIT per ${cacheKey}. Risposta istantanea.`);
                    const isNewFormat = typeof cachedData === 'object' && cachedData.analysis;
                    
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

        // --- RIMOSSO IL BLOCCO SIGTERM (La simulazione MCP non ha un processo da chiudere) ---
        
        // Avvia Express
        const PORT = process.env.PORT || 10000;
        app.listen(PORT, () => {
          logger.log(`[SERVER STARTUP] 🎣 Server pronto e in ascolto sulla porta ${PORT}`);
        });

    } catch (e) {
        console.error('--- [FATAL BOOT ERROR] Errore durante l\'avvio e le importazioni ---');
        console.error(e);
        process.exit(1);
    }
}

// Avvia l'applicazione
start();