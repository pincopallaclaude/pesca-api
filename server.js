// server.js

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import * as logger from './lib/utils/logger.js';
import axios from 'axios';

console.log('--- [SERVER BOOT] Entry point server.js caricato ---');
console.log('[SERVER BOOT] 📦 Tentativo di avvio rapido...');

// --- DEFINISCI L'APP E L'HEALTH CHECK IMMEDIATO ---
const app = express();
app.use(cors());
app.use(express.json());

// Inizializza una variabile per tenere traccia dello stato di prontezza dei servizi critici
let servicesReady = false; 
const CRITICAL_SERVICES = ['MemoryEngine', 'MCP'];
const serviceStatus = { MemoryEngine: 'initializing', MCP: 'initializing' };

// Health check primario: risponde subito con 200/ok a Render/Kubernetes
app.get('/health', (req, res) => {
    // Risponde con 503 se i servizi critici non sono ancora pronti
    if (!servicesReady) {
        logger.warn('[HEALTH] Server non completamente pronto, restituisco 503.');
        return res.status(503).json({ 
            status: 'initializing', 
            message: 'Attendo l\'inizializzazione dei servizi critici (MemoryEngine, MCP).',
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
        const { initMemoryEngine } = await import('./lib/db/memory.engine.js');
        const { mcpClient } = await import('./lib/services/mcp-client.service.js');
        const { migrateKnowledgeBase } = await import('./tools/migrate-to-chromadb.js');
        // --- NUOVO IMPORT PER L'ANALISI PROATTIVA ---
        const { generateProactiveAnalysis } = await import('./lib/services/proactive_analysis.service.js');
        
        // Handler API
        const { default: autocompleteHandler } = await import('./api/autocomplete.js');
        const { default: reverseGeocodeModule } = await import('./api/reverse-geocode.js');
        const { default: analyzeDayFallbackModule } = await import('./api/analyze-day-fallback.js');
        const { default: queryNaturalLanguage } = await import('./api/query-natural-language.js');
        const { default: recommendSpecies } = await import('./api/recommend-species.js');
        const { default: memoryHealthHandler } = await import('./api/memory-health.js'); 
        const { default: submitFeedbackHandler } = await import('./api/submit-feedback.js'); 
        const { default: cleanupMemoryHandler } = await import('./api/admin/cleanup-memory.js'); 
        
        console.log('--- [SERVER BOOT] Moduli principali importati ---');

        // --- INIZIALIZZAZIONE DEI SERVIZI IN BACKGROUND (Non-Blocking) ---
        
        // 1. Inizializzazione del nuovo Hybrid Memory Engine
        initMemoryEngine()
            .then(() => {
                serviceStatus.MemoryEngine = 'ready';
                logger.log("[BACKGROUND] ✅ Hybrid Memory Engine (SQLite + ChromaDB) pronto.");
                
                // Qui in futuro potremmo aggiungere la migrazione della KB statica
                
                checkServicesReady();
            })
            .catch(err => {
                serviceStatus.MemoryEngine = 'failed';
                logger.error("[BACKGROUND] ❌ Inizializzazione Memory Engine fallita:", err.message);
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
            if (serviceStatus.MemoryEngine === 'ready' && serviceStatus.MCP === 'ready') {
                servicesReady = true;
                logger.log('[SERVER STARTUP] 🏁 Tutti i servizi critici sono ora pronti.');
            }
        }
        
        // --- ROUTES DELL'APPLICAZIONE (che dipendono dai servizi) ---
        
        // Route di controllo
        app.get('/', (req, res) => res.status(200).send('Pesca API Server is running!'));

        // =========================================================================
        // --- ENDPOINT DI DIAGNOSTICA (Admin) ---
        // =========================================================================
        app.get('/admin/inspect-db', async (req, res) => {
            // Protezione (invariata)
            if (req.query.secret !== (process.env.ADMIN_SECRET || 'supersecret')) {
                return res.status(401).send('Unauthorized');
            }

            logger.log('[Admin] Eseguo ispezione del database via API...');
            try {
                const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';
                // Usiamo la collection degli episodi, che è quella che ci interessa ora
                const COLLECTION_NAME = 'fishing_episodes'; 

                let inspectionResult = {};

                // 1. Lista tutte le collection
                const collectionsResponse = await axios.get(`${CHROMA_API_URL}/collections`);
                const collection = collectionsResponse.data.find(c => c.name === COLLECTION_NAME);

                if (!collection) {
                    inspectionResult.error = `Collection "${COLLECTION_NAME}" non trovata.`;
                    return res.status(404).json(inspectionResult);
                }

                inspectionResult.collectionName = collection.name;
                inspectionResult.collectionId = collection.id;
                
                // 2. Conta i documenti
                const countResponse = await axios.get(`${CHROMA_API_URL}/collections/${collection.id}/count`);
                inspectionResult.documentCount = countResponse.data;

                // 3. Recupera un campione di documenti se presenti
                if (inspectionResult.documentCount > 0) {
                    const getResponse = await axios.post(`${CHROMA_API_URL}/collections/${collection.id}/get`, { 
                        limit: 5, 
                        include: ["metadatas", "documents"] 
                    });
                    inspectionResult.sampleDocuments = getResponse.data.documents;
                    inspectionResult.sampleMetadatas = getResponse.data.metadatas;
                } else {
                    inspectionResult.sampleDocuments = [];
                    inspectionResult.sampleMetadatas = [];
                }
                
                logger.log('[Admin] Ispezione completata.');
                res.json(inspectionResult);

            } catch (error) {
                // Gestione errore robusta per evitare crash
                const errorMessage = error.response ? error.response.data : error.message;
                logger.error('[Admin] Errore durante ispezione:', errorMessage);
                res.status(500).json({ error: 'Errore durante ispezione', details: errorMessage });
            }
        });

        // --- Endpoint di diagnostica per la memoria ---
        app.get('/api/admin/memory-health', memoryHealthHandler);
        app.get('/api/admin/cleanup-memory', cleanupMemoryHandler);


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

        // =========================================================================
        // --- AGGIORNAMENTO CRON JOB ENDPOINT (Ora usa l'Agente Proattivo) ---
        // =========================================================================
        app.get('/api/update-cache', async (req, res) => {
            const secret = req.query.secret;
            // Usa il token segreto CRON_SECRET_KEY che hai già definito
            if (secret !== process.env.CRON_SECRET_KEY) {
                console.warn('[CRON JOB] Tentativo di accesso non autorizzato a /api/update-cache');
                return res.status(401).json({ message: 'Unauthorized' });
            }
            
            // Controllo cruciale: impedisce che il cron parta prima che i servizi siano pronti
            if (!servicesReady) {
                logger.warn('[CRON JOB] Rifiuto esecuzione: Servizi critici non pronti (Memory Engine/MCP).');
                return res.status(503).json({ status: 'not_ready', message: 'Servizi critici non pronti, riprovare più tardi.' });
            }

            try {
                // *** CHIAMATA AL NUOVO GESTORE DELL'ANALISI PROATTIVA ***
                const result = await generateProactiveAnalysis(POSILLIPO_COORDS.lat, POSILLIPO_COORDS.lon); 

                console.log('[CRON JOB] ✅ Cache di Posillipo aggiornata con successo. Tempo: ' + result.executionTimeMs + 'ms');
                return res.status(200).json({ 
                    status: 'ok', 
                    message: 'Cache aggiornata',
                    details: result 
                });
            } catch (error) {
                console.error("[CRON JOB] ❌ Errore durante l'aggiornamento della cache:", error.message);
                // Restituisce 500 o 503 per indicare al servizio Cron che ha fallito
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
        app.post('/api/submit-feedback', submitFeedbackHandler);

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