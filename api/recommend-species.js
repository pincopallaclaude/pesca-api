// /api/recommend-species.js  ----------- PRIMA

import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache } from '../lib/utils/cache.manager.js';
// 🔥 Importiamo il logger unificato e il servizio RAG
import { error, log, warn } from '../lib/utils/logger.js'; 
import { queryKnowledgeBase } from '../lib/services/chromadb.service.js'; 

export default async function recommendSpecies(req, res) {
    const { species, location, lat, lon } = req.body;
    
    if (!species || !location) {
        return res.status(400).json({
            error: 'Campi obbligatori: species, location. Campi opzionali: lat, lon',
            example: {
                species: "spigola",
                location: "Posillipo",
                lat: 40.813,
                lon: 14.208
            },
            availableSpecies: ['spigola', 'orata', 'serra', 'calamaro']
        });
    }
    
    const speciesName = species.toLowerCase().trim();
    log(`[API /recommend-species] Richiesta per ${speciesName} @ ${location}`);

    try {
        // --- 1. RECUPERO DATI METEO ---
        let cacheLocationKey;
        if (lat && lon) {
            cacheLocationKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
            log(`[API /recommend-species] Usando coordinate cache: ${cacheLocationKey}`);
        } else {
            cacheLocationKey = location;
            log(`[API /recommend-species] Usando nome località cache: ${cacheLocationKey}`);
        }
        
        const cacheKey = `forecast-data-v-refactored-${cacheLocationKey}`;
        const weatherData = myCache.get(cacheKey);
        
        if (!weatherData) {
            warn(`[API /recommend-species] Dati meteo non in cache per la chiave: ${cacheKey}`);
            return res.status(404).json({
                error: 'Dati meteo non disponibili per questa località',
                action: 'fetch_forecast_first',
                message: 'Chiama prima /api/forecast per ottenere i dati meteo',
                location: location
            });
        }
        
        // --- 2. RECUPERO CONTESTO DALLA KNOWLEDGE BASE (RAG) ---
        // Combineremo la specie e la località per una ricerca mirata (es. "tecniche per spigola a Posillipo")
        const ragQuery = `Consigli, esche e tecniche per pescare ${speciesName} a ${location}`;
        const kbContext = await queryKnowledgeBase(ragQuery, 4); // Chiede 4 documenti di contesto
        
        log(`[API /recommend-species] RAG completato. Trovati ${kbContext.length} frammenti di contesto KB.`);

        // --- 3. INVOCAZIONE DELLO STRUMENTO MCP ---
        
        const result = await mcpClient.callTool('recommend_for_species', {
            species: speciesName,
            weatherData: weatherData.forecast,
            location: weatherData.forecast[0].location?.name || location,
            // 🔥 AGGIUNTA DEL CONTESTO RAG
            kbContext: kbContext.join('\n\n---\n\n'), 
        });
        
        log(`[API /recommend-species] ✅ Raccomandazioni generate`);
        
        // Controlla se il risultato è un errore prima di tentare l'accesso a content[0]
        if (result.isError) {
             error(`[API /recommend-species] ❌ Errore MCP Tool: ${result.content[0].text}`);
             throw new Error(result.content[0].text);
        }

        return res.status(200).json({
            species: species,
            location: weatherData.forecast[0].location?.name || location,
            // Assumiamo che il tool restituisca un JSON o una stringa formattata qui
            recommendations: result.content[0].text, 
            metadata: {
                compatibilityScore: result.metadata?.compatibilityScore,
                compatibilityLevel: result.metadata?.compatibilityLevel,
                warnings: result.metadata?.warnings,
                advantages: result.metadata?.advantages,
                documentsUsed: result.metadata?.documentsUsed,
                timingMs: result.metadata?.timingMs,
                generatedAt: result.metadata?.generatedAt,
            },
        });
        
    } catch (err) {
        // 🔥 Uso del logger unificato
        error('[API /recommend-species] ❌ Errore durante la generazione raccomandazioni:', err);
        return res.status(500).json({
            error: 'Errore generazione raccomandazioni',
            message: err.message,
            species: species,
            location: location,
        });
    }
}