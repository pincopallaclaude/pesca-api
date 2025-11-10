// lib/domain/weather.service.js

import { fetchWwoData as fetchWwoDailyData } from '../services/wwo.service.js';
import { fetchOpenMeteoData as fetchOpenMeteoHourlyData } from '../services/openmeteo.service.js';
import { fetchStormglassData } from '../services/stormglass.service.js';
import * as logger from '../utils/logger.js';

/**
 * Orchestra il recupero in parallelo dei dati da tutte le fonti API necessarie.
 * @param {number|string} lat - Latitudine.
 * @param {number|string} lon - Longitudine.
 * @param {boolean} usePremium - Se true, include anche la chiamata a Stormglass.
 * @returns {Promise<Array>} Un array contenente i risultati delle chiamate API: [wwoData, openMeteoData, stormglassData?].
 */
export async function fetchAllWeatherData(lat, lon, usePremium = false) {
    const apiCalls = [
        fetchWwoDailyData(lat, lon),
        fetchOpenMeteoHourlyData(lat, lon),
    ];

    if (usePremium) {
        logger.log('[Weather Service] Location è Posillipo. Aggiungo fetch premium (Stormglass)...');
        apiCalls.push(fetchStormglassData(lat, lon));
    }

    try {
        // Esegue tutte le chiamate API in parallelo per massima efficienza
        const results = await Promise.all(apiCalls.map(p => p.catch(e => {
            // Impedisce che il fallimento di una singola API blocchi tutto.
            // Logga l'errore e restituisce null, che verrà gestito a valle.
            logger.error(`[Weather Service] Una chiamata API è fallita: ${e.message}`);
            return null; 
        })));
        return results;
    } catch (error) {
        logger.error(`[Weather Service] Errore critico durante Promise.all: ${error.message}`);
        // Se Promise.all fallisce in modo catastrofico, restituisce un array di null
        // della lunghezza attesa per evitare crash a valle.
        return usePremium ? [null, null, null] : [null, null];
    }
}