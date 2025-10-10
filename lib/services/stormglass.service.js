// /lib/services/stormglass.service.js
const axios = require('axios');

/**
 * Funzione per recuperare i dati di Corrente Marina (e solo quelli) da Stormglass.
 * Questo servizio viene chiamato SOLO per la zona di Posillipo.
 *
 * @param {number} lat - Latitudine.
 * @param {number} lon - Longitudine.
 * @param {object} utilities - L'oggetto utilities contenente degreesTo16PointDirection e altre helper.
 * @returns {Promise<object>} - Dati della corrente raggruppati per giorno.
 */
async function fetchStormglassData(lat, lon, utilities) {
    const apiKey = process.env.STORMGLASS_API_KEY;
    if (!apiKey) {
        throw new Error("STORMGLASS_API_KEY non è definito nelle variabili d'ambiente.");
    }
    
    // Solo i dati di Corrente Veloce e Corrente Direzione
    const params = 'currentSpeed,currentDirection';
    // Data di oggi e 7 giorni avanti (Stormglass supporta fino a 10 giorni)
    const end = Math.floor(Date.now() / 1000) + 7 * 24 * 3600; 

    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}&params=${params}&end=${end}`;

    console.log('[Stormglass Service] Fetching data...');
    
    // Gestione dei retry con backoff esponenziale (best practice)
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await axios.get(url, {
                headers: {
                    'Authorization': apiKey
                }
            });

            if (!response.data || !response.data.hours) {
                throw new Error("Struttura della risposta Stormglass non valida.");
            }

            const dataByDay = {};

            response.data.hours.forEach(hourData => {
                // La data di Stormglass è un timestamp ISO
                const isoDate = hourData.time;
                const date = isoDate.split('T')[0];
                const hour = isoDate.split('T')[1].substring(0, 2);

                // Estrarre i valori, usando 'null' se non disponibili
                const speedKph = hourData.currentSpeed ? (hourData.currentSpeed.sg || hourData.currentSpeed.icon) : null;
                const directionDeg = hourData.currentDirection ? (hourData.currentDirection.sg || hourData.currentDirection.icon) : null;

                // Converione KPH in Knots (nodi, 1 KPH ≈ 0.539957 Kn)
                const speedKn = speedKph !== null ? (speedKph * 0.539957).toFixed(2) : null;
                
                // Conversione gradi in direzione cardinale
                const directionStr = directionDeg !== null 
                    ? utilities.degreesTo16PointDirection(directionDeg) // <<-- FIX APPLICATO QUI
                    : 'N/D';

                if (!dataByDay[date]) dataByDay[date] = [];

                dataByDay[date].push({
                    hour: hour,
                    currentSpeedKn: speedKn !== null ? speedKn : 'N/D',
                    currentDirectionStr: directionStr,
                });
            });

            console.log(`[Stormglass Service] Dati recuperati e processati per ${Object.keys(dataByDay).length} giorni.`);
            return dataByDay;

        } catch (error) {
            if (attempt < 3) {
                const delay = Math.pow(2, attempt) * 1000;
                // console.warn(`[Stormglass Service] Tentativo ${attempt} fallito. Riprovo in ${delay / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // Rilanciamo l'errore al chiamante (forecast-logic.js)
                throw new Error(`Stormglass fetch failed: ${error.message}`); 
            }
        }
    }
}

module.exports = {
    fetchStormglassData
};
