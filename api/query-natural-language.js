// /api/query-natural-language.js

import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache } from '../lib/utils/cache.manager.js';
import { POSILLIPO_COORDS } from '../lib/utils/constants.js';
import { normalizeCoords } from '../lib/utils/geo.utils.js';

// Funzione di utilità per costruire la chiave cache in modo coerente
function buildCacheKey(location) {
    // Caso 1: Posillipo (usa la costante di coordinate)
    if (location === 'Posillipo') {
        return `forecast-data-v-refactored-${POSILLIPO_COORDS}`;
    }
    
    // Caso 2: Coordinate in formato "lat,lon"
    if (typeof location === 'string' && location.includes(',')) {
        const [lat, lon] = location.split(',');
        // normalizeCoords ha bisogno di due argomenti se non gli si passa una stringa "lat,lon"
        // Dato che l'input location potrebbe non essere normalizzato, passiamo i componenti.
        // Assumiamo che normalizeCoords con due argomenti ritorni {lat, lon}
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

    try {
        // NUOVO BLOCCO PER GESTIRE LA CACHE KEY E RECUPERARE I DATI METEO
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
        
        const result = await mcpClient.callTool('natural_language_forecast', {
            query,
            weatherData,
            location: weatherData?.location?.name || targetLocation,
        });

        if (result.isError) throw new Error(result.content[0].text);

        const responsePayload = JSON.parse(result.content[0].text);
        res.json({ data: responsePayload, metadata: result.metadata });

    } catch (error) {
        // CORREZIONE: Sostituito console.error con log su stderr
        process.stderr.write(`[API query] Errore: ${error.message}\n`);
        res.status(500).json({ error: `Errore durante l'elaborazione della query: ${error.message}` });
    }
}
