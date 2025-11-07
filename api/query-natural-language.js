// /api/query-natural-language.js

import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache } from '../lib/utils/cache.manager.js';
import { POSILLIPO_COORDS } from '../lib/utils/constants.js';
import { normalizeCoords } from '../lib/utils/geo.utils.js';
// 🔥 Importiamo il logger unificato
import { error, log, warn } from '../lib/utils/logger.js';
// 🔥 Importiamo la funzione di query RAG
import { queryKnowledgeBase } from '../lib/services/chromadb.service.js'; 

// Funzione di utilità per costruire la chiave cache in modo coerente
function buildCacheKey(location) {
    // Caso 1: Posillipo (usa la costante di coordinate)
    if (location === 'Posillipo') {
        return `forecast-data-v-refactored-${POSILLIPO_COORDS}`;
    }
    
    // Caso 2: Coordinate in formato "lat,lon"
    if (typeof location === 'string' && location.includes(',')) {
        const [lat, lon] = location.split(',');
        const normalized = normalizeCoords(lat, lon);
        // Costruisce la chiave come stringa "lat,lon" normalizzata
        return `forecast-data-v-refactored-${normalized.lat},${normalized.lon}`;
    }
    
    // Caso 3: Nome località (usa il nome normalizzato in minuscolo)
    return `forecast-data-v-refactored-${location.toLowerCase()}`;
}

export default async function queryNaturalLanguage(req, res) {
    const { query, location } = req.body;
    if (!query) {
        return res.status(400).json({ error: 'Parametro "query" richiesto.' });
    }
    
    // Aggiungiamo un log per tracciare la query in arrivo
    log(`[API Query] Nuova query ricevuta: "${query.substring(0, 50)}..."`);


    try {
        // --- 1. RECUPERO DATI METEO ---
        let weatherData = null;
        let targetLocation = location;

        if (targetLocation) {
            const cacheKey = buildCacheKey(targetLocation);
            const forecastData = myCache.get(cacheKey);
            
            if (forecastData) {
                // Prende solo il primo giorno di previsione (previsioni di oggi)
                weatherData = forecastData.forecast[0];
            }
        }
        
        // --- 2. RECUPERO CONTESTO DALLA KNOWLEDGE BASE (RAG) ---
        // Utilizziamo la query dell'utente per trovare i documenti rilevanti.
        const kbContext = await queryKnowledgeBase(query, 5); // Chiede 5 documenti
        
        log(`[API Query] RAG completato. Trovati ${kbContext.length} frammenti di contesto KB.`);

        // --- 3. INVOCAZIONE DELLO STRUMENTO MCP ---
        const result = await mcpClient.callTool('natural_language_forecast', {
            query,
            weatherData,
            location: weatherData?.location?.name || targetLocation,
            // 🔥 AGGIUNTA DEL CONTESTO RAG
            kbContext: kbContext.join('\n\n---\n\n'), 
        });

        if (result.isError) {
             error(`[API Query] ❌ Errore MCP Tool: ${result.content[0].text}`);
             throw new Error(result.content[0].text);
        }

        const responsePayload = JSON.parse(result.content[0].text);
        res.json({ data: responsePayload, metadata: result.metadata });

    } catch (err) {
        // 🔥 Uso del logger unificato
        error(`[API query] ❌ Errore durante l'elaborazione della query: ${err.message}`, err);
        res.status(500).json({ error: `Errore durante l'elaborazione della query: ${err.message}` });
    }
}