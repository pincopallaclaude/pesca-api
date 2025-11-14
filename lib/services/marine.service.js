// lib/services/marine.service.js

/**
 * Marine Service (Simulazione StormGlass)
 * Questo modulo si concentra sull'estrazione dei dati marini cruciali (onde, correnti, temperatura)
 * da un'API esterna (qui simulata) per l'Agente di Pesca.
 * * L'obiettivo è fornire dati puliti per il Tool getMarineForecastTool.
 */
import * as logger from '../utils/logger.js';
// In un'implementazione reale, qui importeremmo un client HTTP come axios.

/**
 * Simula il recupero delle previsioni marine da un'API esterna.
 * In un'implementazione reale, qui si integrerebbe StormGlass o un servizio simile.
 * @param {number} lat - Latitudine.
 * @param {number} lon - Longitudine.
 * @returns {Promise<object>} Dati marini chiave (correnti, onde, temperatura).
 */
export async function fetchMarineData(lat, lon) {
    logger.log(`[Marine Service] Richiesta dati marini per Lat: ${lat}, Lon: ${lon}...`);

    // In un ambiente reale, avremmo una logica per chiamare l'API con un token.
    // Esempio: 
    // const apiUrl = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}&params=waterTemperature,waveHeight,currentSpeed`;
    // const response = await axios.get(apiUrl, { headers: { 'Authorization': 'YOUR_API_KEY' } });

    // Simulazione di dati in base alla zona (per coerenza logica)
    let waveHeight = 0.5;
    let currentSpeed = 0.2;
    let waterTemperature = 15.0;

    // Logica fittizia per simulare condizioni diverse
    if (lat > 40 && lon < 10) { // Esempio: Mediterraneo occidentale/alto
        waveHeight = Math.max(0.2, Math.random() * 1.5); // Onde leggere/moderate
        currentSpeed = Math.max(0.1, Math.random() * 0.5); // Correnti deboli
        waterTemperature = Math.max(10, Math.random() * 10 + 10); // Acqua fredda/temperata
    } else { // Esempio: Atlantico o zone più temperate
        waveHeight = Math.max(0.8, Math.random() * 2.5); // Onde più significative
        currentSpeed = Math.max(0.3, Math.random() * 1.0); // Correnti moderate/forti
        waterTemperature = Math.max(18, Math.random() * 5 + 18); // Acqua calda/temperata
    }
    
    // Arrotondiamo i valori per una presentazione pulita
    const simulatedData = {
        wave_height_meters: waveHeight.toFixed(1),
        water_current_speed_m_per_s: currentSpeed.toFixed(1),
        water_temperature_celsius: waterTemperature.toFixed(1),
        tide_status: (Math.random() > 0.5) ? "Rising" : "Falling"
    };

    logger.log('[Marine Service] Dati simulati:', simulatedData);
    
    return simulatedData;
}