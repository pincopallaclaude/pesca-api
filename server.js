// server.js

console.log('--- [SERVER BOOT] Entry point server.js caricato ---');
console.log('[SERVER BOOT] 📦 Tentativo di importazione dei moduli...');

// Uso di await di primo livello (Top-Level Await) per le importazioni
try {
    // Importazioni di librerie standard
    const { default: express } = await import('express');
    const { default: cors } = await import('cors');
    await import('dotenv/config');

    // Moduli core e servizi
    const { fetchAndProcessForecast, POSILLIPO_COORDS } = await import('./lib/forecast-logic.js');
    console.log('[SERVER BOOT] ✅ forecast-logic importato');

    const { analysisCache } = await import('./lib/utils/cache.manager.js');
    console.log('[SERVER BOOT] ✅ cache.manager importato');

    // RIMOZIONE: Rimozione del vecchio servizio vettoriale
    // const { loadKnowledgeBaseFromFile } = await import('./lib/services/vector.service.js');
    // console.log('[SERVER BOOT] ✅ vector.service importato');
    
    // 🔥 AGGIUNTA 1: Importazione del nuovo servizio ChromaDB
    const { initializeChromaDB } = await import('./lib/services/chromadb.service.js');
    
    const { mcpClient } = await import('./lib/services/mcp-client.service.js');
    console.log('[SERVER BOOT] ✅ mcp-client importato');

    // Handler API
    const { default: autocompleteHandler } = await import('./api/autocomplete.js');
    const { default: reverseGeocodeModule } = await import('./api/reverse-geocode.js');
    const { default: analyzeDayFallbackModule } = await import('./api/analyze-day-fallback.js');
    const { default: queryNaturalLanguage } = await import('./api/query-natural-language.js');
    const { default: recommendSpecies } = await import('./api/recommend-species.js');
    console.log('[SERVER BOOT] ✅ Tutti gli handler API importati');

    console.log('--- [SERVER BOOT] Tutti i moduli importati con successo ---');

    // Validazione environment
    if (!process.env.GEMINI_API_KEY) {
        console.error("FATAL ERROR: GEMINI_API_KEY not found!");
        process.exit(1);
    }

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

    // RE-ADDED: Route per l'aggiornamento forzato della cache (Cron Job)
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

    // --- AVVIO E SHUTDOWN ---
    async function startServer() {
        console.log('[SERVER STARTUP] 🚀 Inizializzazione...');
        
        // Loop di retry per la connessione a ChromaDB
        let chromaReady = false;
        for (let i = 0; i < 10; i++) {
            try {
                await initializeChromaDB();
                chromaReady = true;
                console.log('[SERVER STARTUP] ✅ ChromaDB pronto');
                break; // Esci dal loop se la connessione ha successo
            } catch (error) {
                console.warn(`[SERVER STARTUP] ⏳ ChromaDB non ancora pronto (tentativo ${i + 1}/10). Riprovo in 3s...`);
                await new Promise(res => setTimeout(res, 3000)); // Attendi 3 secondi
            }
        }

        if (!chromaReady) {
            console.error('[SERVER STARTUP] ❌ ChromaDB fallito dopo 10 tentativi. Uscita.');
            process.exit(1);
        }
        
        // Step 2: Connette client MCP
        console.log('[SERVER STARTUP] 🔌 Connessione MCP client...');
        await mcpClient.connect();
        console.log('[SERVER STARTUP] ✅ MCP client connesso');

        // Step 3: Avvia Express
        app.listen(PORT, '0.0.0.0', () => {
          console.log(`[SERVER STARTUP] 🎣 Server pronto su host 0.0.0.0, porta ${PORT}`);
          console.log(`[SERVER STARTUP] 🤖 Sistema MCP-Enhanced attivo`);
        });
    }

    // RE-ADDED: Gestione dello shutdown per chiudere correttamente la connessione MCP
    process.on('SIGTERM', async () => {
        console.log('📴 SIGTERM ricevuto, shutdown graceful...');
        await mcpClient.disconnect();
        process.exit(0);
    });
    
    // Avvia l'applicazione
    startServer();

} catch (e) {
    console.error('--- [FATAL BOOT ERROR] Errore durante l\'avvio e le importazioni ---');
    console.error(e);
    process.exit(1);
}