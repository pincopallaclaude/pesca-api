 // server.js


// Load environment variables
import 'dotenv/config'; // Usa il nuovo standard ES Module per caricare le variabili d'ambiente
import express from 'express';
import cors from 'cors';
import path from 'path'; // Mantenuto per coerenza, anche se non strettamente usato per static files
import { fileURLToPath } from 'url'; // Necessario per __dirname se fosse usato per path assoluti


// Servizi e logiche
import { fetchAndProcessForecast, POSILLIPO_COORDS } from './lib/forecast-logic.js'; // Importato POSILLIPO_COORDS
import { myCache, analysisCache } from './lib/utils/cache.manager.js';
import { loadKnowledgeBaseFromFile } from './lib/services/vector.service.js'; // Ancora necessario per pre-caricare il DB


// Handler API
import autocompleteHandler from './api/autocomplete.js';
import reverseGeocodeModule from './api/reverse-geocode.js'; // Importato l'export default
import analyzeDayFallbackModule from './api/analyze-day-fallback.js'; // Importato l'export default
import queryNaturalLanguage from './api/query-natural-language.js'; // Nuovo import
import recommendSpecies from './api/recommend-species.js'; // Nuovo import
import { mcpClient } from './lib/services/mcp-client.service.js'; // MCP CLIENT

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
app.get('/health', async (req, res) => {
    // Nota: Ho modificato questa route per riflettere un pattern più comune
    // di health check e per includere lo stato MCP
    const mcpStatus = mcpClient.connected ? 'connected' : 'disconnected';
    res.json({
        status: 'ok',
        mcp: mcpStatus,
        timestamp: new Date().toISOString()
    });
});

// Route principale per i dati meteo
app.get('/api/forecast', async (req, res) => {
    try {
        // USO POSILLIPO_COORDS come default se la location non è specificata
        const location = req.query.location || POSILLIPO_COORDS;
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
        await fetchAndProcessForecast(POSILLIPO_COORDS); // Uso POSILLIPO_COORDS
        return res.status(200).json({ status: 'ok' });
    } catch (error) {
        console.error("[CRON JOB] Error during update:", error.message);
        return res.status(500).json({ status: 'error' });
    }
});

// Route per l'autocomplete e il reverse geocoding
app.get('/api/autocomplete', autocompleteHandler);

// CORREZIONE: Usare l'export default corretto
app.get('/api/reverse-geocode', reverseGeocodeModule);


// =========================================================================
// --- [PHANTOM] ENDPOINT A LATENZA ZERO (PRIMARIO) - AGGIORNATO CON METADATA ---
// =========================================================================
app.post('/api/get-analysis', async (req, res) => { // Aggiunto 'async' per coerenza
    try {
        const { lat, lon } = req.body;

        if (!lat || !lon) {
            return res.status(400).json({
                error: 'Coordinate mancanti',
                status: 'error'
            });
        }

        // !!! CHIAVE UNIFICATA: lat_lon (senza prefisso 'analysis-v2')
        const cacheKey = `${parseFloat(lat).toFixed(3)}_${parseFloat(lon).toFixed(3)}`;

        const cachedAnalysis = analysisCache.get(cacheKey);

        if (cachedAnalysis) {
            console.log(`[Phantom-API] ✅ Cache HIT per analisi ${cacheKey}. Risposta istantanea.`);

            // Verifica se è la vecchia cache (solo stringa) o la nuova (oggetto)
            const isLegacyString = typeof cachedAnalysis === 'string';

            // ✅ NUOVO: Ritorna oggetto completo con metadata
            return res.json({
                status: 'ready',
                // Se è stringa, usa la stringa. Altrimenti, usa il campo 'analysis'
                analysis: isLegacyString ? cachedAnalysis : cachedAnalysis.analysis,
                // Se è un oggetto, estrai i metadati
                metadata: isLegacyString ? undefined : {
                    locationName: cachedAnalysis.locationName,
                    modelUsed: cachedAnalysis.modelUsed,
                    modelProvider: cachedAnalysis.modelProvider,
                    complexityLevel: cachedAnalysis.complexityLevel,
                    generatedAt: cachedAnalysis.generatedAt,
                    timingMs: cachedAnalysis.timingMs,
                },
            });
        } else {
            console.log(`[Phantom-API] ⏳ Cache MISS per analisi ${cacheKey}. Il client userà il fallback.`);
            return res.json({
                status: 'pending',
                message: 'Analisi in elaborazione...',
            });
        }

    } catch (error) {
        console.error('[GET Analysis] ❌ Errore:', error);
        res.status(500).json({
            error: 'Errore recupero analisi',
            status: 'error'
        });
    }
});



// =========================================================================
// --- [FALLBACK] ENDPOINT ON-DEMAND - ORA USA MCP ---
// =========================================================================
// CORREZIONE: Usare l'export default corretto
app.post('/api/analyze-day-fallback', analyzeDayFallbackModule);

// === NEW: Advanced AI Features ===
app.post('/api/query', queryNaturalLanguage);
app.post('/api/recommend-species', recommendSpecies);

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