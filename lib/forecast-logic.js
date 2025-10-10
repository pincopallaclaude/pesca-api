// /lib/forecast-logic.js

const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');
const { fetchStormglassData } = require('./services/stormglass.service')


const myCache = new NodeCache({ stdTTL: 21600 });
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';
const cacheLocks = new Map();

/**
 * Funzione centralizzata di logging. Stampa sulla console del backend.
 * Nota: NON aggiunge i log ad un payload da inviare al client per motivi di performance.
 * @param {string} message - Messaggio di log.
 * @param {string} source - Sorgente del log (es. 'Master Fetch', 'DEBUG Summary').
 */
const log = (message, source = 'Master Fetch') => {
    const fullMessage = `--- [${source}] ${message} ---`;
    console.log(fullMessage);
};

/**
 * Calcola la distanza tra due coordinate (formula Haversine) e verifica se sono vicine.
 * @param {string} coords1 - "lat,lon" della prima coordinata.
 * @param {string} coords2 - "lat,lon" della seconda coordinata.
 * @param {number} toleranceKm - Tolleranza in chilometri.
 * @returns {boolean}
 */
function areCoordsNear(coords1, coords2, toleranceKm = 1) {
    const [lat1_str, lon1_str] = coords1.split(',');
    const [lat2_str, lon2_str] = coords2.split(',');

    const lat1 = parseFloat(lat1_str);
    const lon1 = parseFloat(lon1_str);
    const lat2 = parseFloat(lat2_str);
    const lon2 = parseFloat(lon2_str);

    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat)/2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon))/2;
    
    const distance = R * 2 * Math.asin(Math.sqrt(a));
    return distance < toleranceKm;
}

// --- SEZIONE UTILITIES ---
const capitalize = (s) => (s && s.charAt(0).toUpperCase() + s.slice(1)) || "";
const degreesTo16PointDirection = (deg) => {
    if (deg === null || deg === undefined) return '';
    const directions = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return directions[Math.round(deg / 22.5) % 16];
};
const convertWmoToWwoCode = (wmoCode) => {
    const code = Number(wmoCode);
    if (code === 0) return '113'; if (code >= 1 && code <= 3) return '116';
    if (code >= 45 && code <= 48) return '260'; if (code >= 51 && code <= 65) return '296';
    if (code >= 66 && code <= 67) return '314'; if (code >= 71 && code <= 77) return '329';
    if (code >= 80 && code <= 82) return '353'; if (code >= 95 && code <= 99) return '389';
    return '119';
};
const formatTimeToHHMM = (timeStr) => {
    if (!timeStr) return 'N/D';

    // Se contiene AM/PM, va convertito
    if (String(timeStr).includes('AM') || String(timeStr).includes('PM')) {
        let [time, modifier] = String(timeStr).split(' ');
        let [hours, minutes] = time.split(':');
        
        hours = parseInt(hours, 10);
        
        if (modifier === 'AM' && hours === 12) { // Mezzanotte
            hours = 0;
        }
        if (modifier === 'PM' && hours !== 12) { // Pomeriggio
            hours += 12;
        }
        
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    // Se è già un formato orario (es. "18:58") lo restituisce
    if (String(timeStr).includes(':')) return timeStr;

    // Gestisce formati numerici (es. "600" -> "06:00")
    const time = String(timeStr).padStart(4, '0');
    return `${time.slice(0, 2)}:${time.slice(2)}`;
};
const getSeaStateAcronym = (height) => {
    if (height === null || isNaN(height)) return '-';
    if (height < 0.1) return 'C'; if (height < 0.5) return 'QC';
    if (height < 1.25) return 'PM'; if (height < 2.5) return 'M';
    if (height < 4) return 'MM'; if (height < 6) return 'A';
    return 'G';
};
const getMeteoIconFromCode = (code) => {
    const codeNum = parseInt(code);
    if ([113].includes(codeNum)) return '☀️';
    if ([116, 119, 122].includes(codeNum)) return '☁️';
    if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(codeNum)) return '🌧️';
    if ([386, 389, 392, 395].includes(codeNum)) return '⛈️';
    if ([179, 182, 185, 323, 326, 329, 332, 335, 338, 368, 371].includes(codeNum)) return '❄️';
    return '🌤️';
}

/**
 * Converte il codice WWO in una descrizione testuale leggibile (per il prompt RAG).
 * @param {string} wwoCode 
 * @returns {string} Descrizione meteo.
 */
const getWeatherDescription = (wwoCode) => {
    const code = Number(wwoCode);
    if (code === 113) return 'Cielo sereno (soleggiato)';
    if ([116, 119].includes(code)) return 'Parzialmente nuvoloso';
    if (code === 122) return 'Molto nuvoloso';
    if ([176, 263, 266, 293, 296].includes(code)) return 'Pioggerella leggera o pioggia debole';
    if ([299, 302, 305, 308, 353, 356, 359].includes(code)) return 'Pioggia moderata/forte';
    if ([386, 389, 392, 395].includes(code)) return 'Temporale o pioggia con fulmini';
    if ([143, 248, 260].includes(code)) return 'Nebbia';
    if ([179, 182, 185, 323, 326, 329, 332, 335, 338, 368, 371].includes(code)) return 'Neve o grandine';
    return 'Non specificato';
};

/**
 * Controlla un valore e restituisce lo stato per il debug (SI, NO, N/D).
 * @param {*} value - Il valore del parametro meteo.
 * @returns {string} - 'SI', 'NO', o 'N/D'.
 */
const getStatusLabel = (value) => {
    // Gestisce specificamente 'N/D' (usato per le correnti) o trend vuoti
    if (typeof value === 'string' && (value.trim().toUpperCase() === 'N/D' || value.trim() === '' || value.trim() === '→')) {
        return 'N/D'; // Consideriamo 'N/D' se è un trend neutro '→'
    }
    // Trend '↓' o '↑' sono considerati 'SI'
    if (typeof value === 'string' && (value.trim() === '↓' || value.trim() === '↑')) {
        return 'SI';
    }
    // Se il valore è null, undefined, o NaN, è NO (mancante/invalido)
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
        return 'NO';
    }
    // Tutto il resto (numeri validi, stringhe non 'N/D'/'→', booleani, ecc.) è SI (disponibile)
    return 'SI';
};


// --- SEZIONE CALCOLO SCORE E FINESTRE ---

/**
 * Calcola il punteggio orario di pescabilità in base a diversi parametri.
 * @param {object} params - Parametri orari.
 * @param {boolean} [shouldLog=false] - Se stampare o meno il log di debug.
 * @returns {{numericScore: number, reasons: Array<object>}} - Punteggio e ragioni.
 */
function calculateHourlyPescaScore(params, shouldLog = false) {
    let score = 3.0;
    const reasons = [];
    
    const { 
        pressure, trendPressione, windSpeedKph, isNewOrFullMoon, 
        cloudCover, waveHeight, waterTemp, currentSpeedKn,
        currentDirectionStr, hour
    } = params;
    
    // ==========================================================
    // ✨ DEBUG AGGIORNATO: Riepilogo dei parametri utilizzati (SI/NO/N/D)
    // ==========================================================
    
    if (shouldLog) { // <--- Il log viene stampato SOLO se shouldLog è true (prima ora)
        // Usiamo getStatusLabel per determinare SI/NO/N/D per ogni parametro
        const pressureStatus = getStatusLabel(pressure);
        const trendStatus = getStatusLabel(trendPressione);
        const windStatus = getStatusLabel(windSpeedKph);
        const cloudStatus = getStatusLabel(cloudCover);
        const waveStatus = getStatusLabel(waveHeight);
        const tempWaterStatus = getStatusLabel(waterTemp);
        // Controlliamo in modo specifico se i dati di corrente sono 'N/D'
        const currentStatus = (currentSpeedKn === 'N/D') ? 'N/D' : getStatusLabel(currentSpeedKn);
        const currentDirStatus = (currentDirectionStr === 'N/D') ? 'N/D' : getStatusLabel(currentDirectionStr);

        // Stampa il riepilogo richiesto, reso più evidente
        console.log(`\n======================================================`);
        console.log(`[Score Calc DEBUG] Parametri Ricevuti per il calcolo (Prima Ora):`);
        console.log(`  - Pressione/Trend: ${pressureStatus} / ${trendStatus}`);
        console.log(`  - Vento: ${windStatus}`);
        console.log(`  - Nuvolosità: ${cloudStatus}`);
        console.log(`  - Onde (WaveHeight): ${waveStatus}`);
        console.log(`  - Temp Acqua: ${tempWaterStatus}`);
        console.log(`  - Corrente (Speed/Dir): ${currentStatus} / ${currentDirStatus}`);
        console.log(`  - Luna (Fase Critica): ${isNewOrFullMoon ? 'SI' : 'NO'}`);
        console.log(`======================================================\n`);
    }
    // ==========================================================

    // Pressione
    if (trendPressione === '↓') { score += 1.5; reasons.push({ icon: 'pressure_down', text: "Pressione in calo", points: "+1.5", type: "positive" }); }
    else if (trendPressione === '↑') { score -= 1.0; reasons.push({ icon: 'pressure_up', text: "Pressione in aumento", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'pressure', text: "Pressione stabile", points: "+0.0", type: "neutral" }); }

    // Vento
    if (windSpeedKph > 5 && windSpeedKph < 20) { score += 1.0; reasons.push({ icon: 'wind', text: "Vento ideale (5-20 km/h)", points: "+1.0", type: "positive" }); }
    else if (windSpeedKph > 30) { score -= 2.0; reasons.push({ icon: 'wind', text: "Vento forte (>30 km/h)", points: "-2.0", type: "negative" }); }
    else { reasons.push({ icon: 'wind', text: "Vento debole/variabile", points: "+0.0", type: "neutral" }); }

    // Luna
    if (isNewOrFullMoon) { score += 1.0; reasons.push({ icon: 'moon', text: "Luna Nuova o Piena", points: "+1.0", type: "positive" }); }
    else { reasons.push({ icon: 'moon', text: "Fase lunare neutra", points: "+0.0", type: "neutral" }); }

    // Nuvolosità
    if (cloudCover > 60) { score += 1.0; reasons.push({ icon: 'clouds', text: "Coperto >60%", points: "+1.0", type: "positive" }); }
    else if (cloudCover < 20 && pressure > 1018) { score -= 1.0; reasons.push({ icon: 'clouds', text: "Sereno con alta pressione", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'clouds', text: "Nuvolosità neutra", points: "+0.0", type: "neutral" }); }

    // Onde (Wave Height)
    if (waveHeight !== null && waveHeight !== undefined) { 
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    } else {
        reasons.push({ icon: 'waves', text: "Dati onde non disp.", points: "+0.0", type: "neutral" });
    }

    // Temperatura dell'acqua
    if (waterTemp !== null && waterTemp !== undefined) {
        if (waterTemp >= 12 && waterTemp <= 20) { 
            score += 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); 
        } else if (waterTemp < 10 || waterTemp > 24) { 
            score -= 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); 
        } else {
            reasons.push({ icon: 'water_temp', text: "Temp. acqua neutra", points: "+0.0", type: "neutral" }); 
        }
    } else {
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
    }
    
    // Logica per la velocità della corrente
    let currentPoints = 0.0;
    let currentText = "Dati corrente non disp.";
    let currentType = "neutral";
    let currentIcon = "swap_horiz";

    // Verifica la disponibilità dei dati di corrente
    if (currentSpeedKn !== 'N/D') {
        const speed = parseFloat(currentSpeedKn);
        
        if (speed > 0.3 && speed <= 0.8) {
            currentPoints = 1.0; currentText = "Corrente ideale (0.3-0.8 kn)"; currentType = "positive";
        } else if (speed > 0.8) {
            currentPoints = -1.0; currentText = "Corrente forte (>0.8 kn)"; currentType = "negative";
        } else {
            currentText = "Corrente debole/nulla"; 
        }
    } 
    
    score += currentPoints;
    reasons.push({ 
        icon: currentIcon, 
        text: currentText, 
        points: currentPoints >= 0 ? `+${currentPoints.toFixed(1)}` : currentPoints.toFixed(1), 
        type: currentType 
    });

    return {
        numericScore: score,
        reasons: reasons
    };
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1; let bestWindowStart = -1;
    // Filtriamo gli score per l'intervallo richiesto
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    
    for (let i = 0; i < relevantHours.length - 1; i++) {
        // Verifichiamo che le ore siano consecutive (es. 9 e 10)
        if(relevantHours[i+1].hour !== relevantHours[i].hour + 1) continue; 
        
        // La finestra è di 2 ore, quindi calcoliamo la media delle due ore consecutive
        const avgScore = (relevantHours[i].score + relevantHours[i + 1].score) / 2;
        
        if (avgScore > bestScore) {
            bestScore = avgScore;
            bestWindowStart = relevantHours[i].hour;
        }
    }
    
    if (bestWindowStart === -1) return null;
    
    const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
    // La finestra va dall'inizio della prima ora all'inizio della terza ora (es. 09:00 - 11:00)
    return `${formatHour(bestWindowStart)} - ${formatHour(bestWindowStart + 2)}`; 
}

// --- SEZIONE FETCHING DATI DALLE API ---
async function fetchOpenMeteoHourly(lat, lon) {
    const forecastParams = ['temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','windspeed_10m','winddirection_10m','weathercode','precipitation_probability','precipitation'].join(',');
    const marineParams = ['wave_height','sea_surface_temperature'].join(',');
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${forecastParams}&forecast_days=7`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineParams}&forecast_days=7`;

    const [forecastResponse, marineResponse] = await Promise.all([axios.get(forecastUrl), axios.get(marineUrl)]);
    const forecastApiData = forecastResponse.data.hourly;
    const marineApiData = marineResponse.data.hourly;
    const dataByDay = {};

    for (let i = 0; i < forecastApiData.time.length; i++) {
        const date = forecastApiData.time[i].split('T')[0];
        if (!dataByDay[date]) dataByDay[date] = [];
        dataByDay[date].push({
            time: forecastApiData.time[i].split('T')[1],
            temperature: forecastApiData.temperature_2m[i],
            humidity: forecastApiData.relative_humidity_2m[i],
            pressure: forecastApiData.pressure_msl[i],
            cloudCover: forecastApiData.cloud_cover[i],
            windSpeed: forecastApiData.windspeed_10m[i],
            windDirection: forecastApiData.winddirection_10m[i],
            weatherCode: forecastApiData.weathercode[i],
            precipitationProbability: forecastApiData.precipitation_probability[i],
            precipitation: forecastApiData.precipitation[i],
            waveHeight: marineApiData.wave_height[i],
            waterTemperature: marineApiData.sea_surface_temperature[i],
        });
    }
    return dataByDay;
}

async function fetchWwoDaily(lat, lon) {
    // La chiave WWO viene caricata da una variabile d'ambiente
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`;
    const response = await axios.get(url);
    if (!response.data?.data?.weather) throw new Error("WWO API response structure is invalid.");
    return response.data.data.weather;
}

// --- FUNZIONE PRINCIPALE UNIFICATA (Nuova Versione) ---
/**
 * Ottiene e processa i dati meteo e di pescabilità, gestendo cache e lock.
 * Restituisce l'oggetto completo di risposta (incluso forecast, fonti, ecc.).
 * @param {string} location - Coordinata "lat,lon".
 * @returns {Promise<object>} - Oggetto di risposta completo.
 */
async function getUnifiedForecastData(location) {
    
    
    // ==========================================================
    // ========= SEZIONE DI DEBUG PER LA CACHE ==================
    // ==========================================================
    log(`Inizio richiesta per location: "${location}"`, 'MASTER FETCH');

    // Arrotondiamo le coordinate per creare una "griglia" e neutralizzare micro-variazioni
    const [lat_str, lon_str] = location.split(',');
    // Usiamo le coordinate arrotondate (toFixed(3)) per uniformare la richiesta su WWO/Stormglass/OpenMeteo
    const lat = parseFloat(lat_str).toFixed(3); // 3 cifre decimali ~ 111 metri di precisione
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    log(`Location normalizzata a 3 decimali: "${normalizedLocation}"`, 'Master Fetch Log');

    const isPosillipo = areCoordsNear(location, POSILLIPO_COORDS);
    
    // CHIAVE: Usiamo la location normalizzata per la chiave della cache
    const cacheKey = `forecast-data-v-ULTIMA-PROVA-1-${normalizedLocation}`;
    
    // ------------------- LOGICA DI CACHE LOCKING (Azione Correttiva) -------------------
    // Se la chiave è già in fase di aggiornamento (un lock esiste), attendiamo il risultato.
    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT: Chiave ${cacheKey} in fase di aggiornamento. Attendo...`, 'Master Fetch Log');
        // Attende la risoluzione della Promise che ha acquisito il lock (che risolve al full object).
        return cacheLocks.get(cacheKey);
    }

    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            log(`Cache HIT for ${location}`, 'Master Fetch Log');
            // Restituisce l'oggetto completo cachato
            return cachedData; 
        }

        log(`Cache MISS for ${location}. Acquisizione LOCK e Fetching new data...`, 'Master Fetch Log');
        
        // 1. Acquisizione del LOCK: Creiamo una Promise e la memorizziamo
        let resolveLock;
        let rejectLock;
        const updatePromise = new Promise((resolve, reject) => {
            resolveLock = resolve;
            rejectLock = reject;
        });
        cacheLocks.set(cacheKey, updatePromise);
        
        // Prepariamo le chiamate in parallelo usando le coordinate ARROTONDATE
        const promises = [
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
        ];

        // Se è Posillipo, aggiungiamo la chiamata a Stormglass
        if (isPosillipo) {
            log(`Location is Posillipo. Adding premium fetch (Stormglass)...`, 'Master Fetch Log');
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed, proceeding without current data:', err.message);
                return null; // Fallback: in caso di errore, restituisce null invece di far fallire tutto
            }));
        }

        // Recuperiamo i dati
        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);
        
        // ==========================================================
        // ✨ DEBUG: Riepilogo Stato API (Aggiornato con la log function)
        // ==========================================================
        let stormglassStatus;
        let criticalDataWarning = '';
        
        // Stato WWO/OpenMeteo: Assumiamo OK se Promise.all è risolto e i dati non sono vuoti.
        const wwoStatus = (wwoDailyData && wwoDailyData.length > 0) ? 'OK' : 'ERROR: Dati WWO mancanti';
        const omStatus = (openMeteoHourlyData && Object.keys(openMeteoHourlyData).length > 0) ? 'OK' : 'ERROR: Dati OpenMeteo mancanti';

        // Stato Stormglass (Gestione chiara dei tre casi: Non richiesto, OK, Errore)
        if (isPosillipo) {
            if (stormglassData) {
                stormglassStatus = 'OK';
            } else {
                // Se fetchStormglassData è fallita (ha ritornato null)
                stormglassStatus = 'ERROR: Fallito (Controllare log del catch)';
                criticalDataWarning = 'Stormglass non ha fornito i dati Corrente/Acqua.';
            }
        } else {
             // Caso NON richiesto (es. 40.7957,14.1889 non è Posillipo)
            stormglassStatus = 'N/D (Non Richiesto)'; 
        }

        log(`[DEBUG Summary] --- Stato API e Dati Critici ---`);
        log(`[DEBUG Summary] 1. WWO Status (Meteo Base/Maree): ${wwoStatus}`);
        log(`[DEBUG Summary] 2. Open Meteo Status (Vento/Onde/Temp Acqua): ${omStatus}`);
        log(`[DEBUG Summary] 3. StormGlass Status (Correnti): ${stormglassStatus}`);
        log(`[DEBUG Summary] ----------------------------------`);
        
        if (criticalDataWarning) {
            log(`[DEBUG Summary] DATI CRITICI ASSENTI: ${criticalDataWarning}`, 'DEBUG Summary');
        }
        // ==========================================================

        // Funzione helper per ottenere i dati di Stormglass per una specifica ora
        const getStormglassCurrent = (date, hour) => {
            const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
            if (!isPosillipo || !stormglassData || !stormglassData[date]) return defaultData;
            const hourStr = String(hour).padStart(2, '0');
            const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
            // Restituisce un oggetto con entrambi i valori o il default 'N/D' per entrambi
            return sgHourData ? { 
                currentSpeedKn: sgHourData.currentSpeedKn, 
                currentDirectionStr: sgHourData.currentDirectionStr 
            } : defaultData;
        };

        let previousDayData = null;
        const finalForecast = [];
        
        // Flag per assicurarsi di loggare i parametri SI/NO/N/D solo una volta (alla prima ora)
        let hasLoggedScoreParams = false;

        for (const wwoDay of wwoDailyData) {
            const date = wwoDay.date;
            const omHourly = openMeteoHourlyData[date];
            if (!omHourly || omHourly.length < 24) continue;
            
            const dailyPressure = omHourly.map(h => h.pressure).reduce((a, b) => a + b, 0) / omHourly.length;
            
            let trendPressione = '→';
            if (previousDayData?.dailyPressure) {
                if (dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
                else if (dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
            }

            const isNewOrFullMoon = wwoDay.astronomy[0].moon_phase.toLowerCase().includes('new moon') || wwoDay.astronomy[0].moon_phase.toLowerCase().includes('full moon');
            
            // [FIX] Robust data enrichment and score calculation
            const hourlyScoresData = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                
                // 1. Explicitly get the current data for THIS hour.
                const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);

                // Determina se questa è l'ora in cui eseguire il log di debug
                // La condizione è: non deve aver loggato prima, deve essere il primo giorno E la prima ora del giorno
                const isFirstDay = date === wwoDailyData[0].date;
                const isFirstHour = currentHour === parseInt(omHourly[0].time.split(':')[0], 10);

                const shouldLog = !hasLoggedScoreParams && isFirstDay && isFirstHour;
                
                if(shouldLog) hasLoggedScoreParams = true; // Imposta il flag dopo il primo check
                
                // 2. Call the score calculator
                const scoreData = calculateHourlyPescaScore({
                    hour: currentHour,
                    pressure: h.pressure,
                    trendPressione,
                    windSpeedKph: h.windSpeed,
                    isNewOrFullMoon,
                    cloudCover: h.cloudCover,
                    waveHeight: h.waveHeight,
                    waterTemp: h.waterTemperature,
                    currentSpeedKn: currentSpeedKn, // Use the variable we just retrieved
                    currentDirectionStr: currentDirectionStr // And the direction
                }, shouldLog); // Passiamo il flag

                // 3. Return a unified object containing all data for the next step.
                return {
                    // Score data
                    hour: currentHour,
                    score: scoreData.numericScore,
                    reasons: scoreData.reasons,
                    // Original OpenMeteo data
                    ...h,
                    // Enriched current data
                    currentSpeedKn,
                    currentDirectionStr,
                };
            });
            
            // Now, we create enrichedHourlyData FROM hourlyScoresData which already contains everything.
            // This ensures data consistency.
            const enrichedHourlyData = hourlyScoresData;
            
            const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
            const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));

            // Calcoliamo i valori medi per l'intera giornata
            const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
            const dailyAvgWindSpeedKph = omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length;
            const dailyAvgPressure = Math.round(omHourly.map(h => h.pressure).reduce((a,b)=>a+b,0) / omHourly.length);

            // Per la direzione del vento e l'icona meteo, usiamo l'ora più rappresentativa (14:00)
            const representativeDailyData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
            const dailyWeatherCode = convertWmoToWwoCode(representativeDailyData.weatherCode);

            // Dati puri per il frontend
            const dailyWindDirectionDegrees = representativeDailyData.windDirection;
            const dailyWindSpeedKn = Math.round(dailyAvgWindSpeedKph / 1.852); // Conversione da Kph a Nodi 
            
            // Helper per convertire l'orario alba/tramonto in un numero per il confronto
            const timeToHours = (timeStr) => {
                const parts = String(timeStr).match(/(\d+):(\d+)\s*(AM|PM)?/);
                if (!parts) return 0;
                let hours = parseInt(parts[1], 10);
                if (parts[3] === 'PM' && hours !== 12) hours += 12;
                if (parts[3] === 'AM' && hours === 12) hours = 0;
                return hours;
            };

            const sunriseHour = timeToHours(wwoDay.astronomy[0].sunrise);
            const sunsetHour = timeToHours(wwoDay.astronomy[0].sunset);

            const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
            const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
            const allTides = [...highTides.map(t => ({...t, type: 'Alta', tideTime: t.tideTime})), ...lowTides.map(t => ({...t, type: 'Bassa', tideTime: t.tideTime}))];
            
            const findClosestTide = (hour, tides) => {
                if (!tides || tides.length === 0) return { type: 'N/A', tideTime: ''};
                return tides.reduce((prev, curr) => {
                    const prevTimeHours = timeToHours(prev.tideTime);
                    const currTimeHours = timeToHours(curr.tideTime);

                    const prevDiff = Math.abs(prevTimeHours - hour);
                    const currDiff = Math.abs(currTimeHours - hour);
                    return currDiff < prevDiff ? curr : prev;
                });
            };

            const hourlyClientFormat = enrichedHourlyData.map(h => {
                const currentHour = h.hour; // Usiamo la proprietà "hour" che è già un intero
                const closestTide = findClosestTide(currentHour, allTides);
                
                return {
                    time: h.time,
                    isDay: currentHour >= sunriseHour && currentHour < sunsetHour,
                    weatherCode: convertWmoToWwoCode(h.weatherCode),
                    tempC: h.temperature,
                    windSpeedKn: Math.round(h.windSpeed / 1.852),
                    windDirectionDegrees: h.windDirection,
                    pressure: h.pressure,
                    humidity: h.humidity,
                    waveHeight: h.waveHeight,
                    waterTemperature: h.waterTemperature,
                    currentSpeedKn: h.currentSpeedKn, // Dato già presente nei dati arricchiti
                    currentDirectionStr: h.currentDirectionStr, // Direzione corrente
                    precipitationProbability: h.precipitationProbability,
                    precipitation: h.precipitation,
                    tide: `${closestTide.type} ${formatTimeToHHMM(closestTide.tideTime)}`,
                };
            });

            // Troviamo il dato orario più vicino all'ora corrente per la rappresentazione giornaliera
            const currentHourData = enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0];
            
            // Temperatura media dell'acqua
            const temperaturaAcqua = String(Math.round(omHourly.map(h=>h.waterTemperature).reduce((a,b)=>a+b,0) / omHourly.length));
            
            // Troviamo il dato di corrente (velocità E direzione) per l'ora rappresentativa
            const currentSpeedKn = currentHourData.currentSpeedKn;
            const currentDirectionStr = currentHourData.currentDirectionStr;

            // L'obiettivo è evitare la stringa "N/D kn N/D" quando i dati sono incompleti.
            const currentDataString = 
                (currentSpeedKn !== 'N/D' && currentDirectionStr !== 'N/D')
                // FIX: Formattiamo la velocità a 1 cifra decimale (kn)
                ? `${parseFloat(currentSpeedKn).toFixed(1)} kn ${currentDirectionStr}`
                : `N/D`;

            finalForecast.push({
                // ---- SEZIONE 1: Dati usati da MainHeroModule (stringhe formattate) ----
                giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                // NUOVO: Descrizione leggibile delle condizioni meteo
                weatherDesc: getWeatherDescription(dailyWeatherCode),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
                pressione: String(Math.round(dailyAvgPressure)),
                umidita: String(dailyAvgHumidity),
                // Vento max (kph) convertito in kn arrotondato, con direzione dell'ora rappresentativa
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(currentHourData.windDirection)}`,
                
                // Mare: stato mare (acronimo) + temp. acqua + velocità/direzione corrente (gestione pulita N/D)
                mare: `${getSeaStateAcronym(currentHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,

                maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
                
                finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
                finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
                
                // ---- SEZIONE 2: Dati di pesca (Con la nuova struttura) ----
                pescaScoreData: {
                    numericScore: avgNumericScore,
                    displayScore: displayScore,
                    // 'hourlyScores' contiene score e reasons specifici per ogni ora
                    hourlyScores: hourlyScoresData.map(h => ({ 
                        time: `${String(h.hour).padStart(2, '0')}:00`, 
                        score: h.score,
                        reasons: h.reasons 
                    })),
                },

                // ---- SEZIONE 3: Dati PURI (numerici) per la tabella settimanale ----
                temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
                temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
                trendPressione: trendPressione,
                dailyWeatherCode: dailyWeatherCode,
                dailyHumidity: dailyAvgHumidity,
                dailyPressure: dailyAvgPressure,
                dailyWindSpeedKn: dailyWindSpeedKn,
                dailyWindDirectionDegrees: dailyWindDirectionDegrees,

                // ---- SEZIONE 4: Dati astronomici e orari ----
                sunriseTime: formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
                sunsetTime: formatTimeToHHMM(wwoDay.astronomy[0].sunset),
                moonPhase: wwoDay.astronomy[0].moon_phase,
                hourly: hourlyClientFormat
            });

            previousDayData = { dailyPressure };
        }

        const apiResponse = {
            fonti: "Open-Meteo & WorldWeatherOnline" + (isPosillipo ? " & Stormglass (Corrente)" : ""),
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        // 2. Scrittura in cache
        myCache.set(cacheKey, apiResponse);
        
        log(`Cache aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');

        // 3. Rilascio del LOCK: Risolve la Promise con l'OGGETTO COMPLETO per le richieste in attesa.
        resolveLock(apiResponse); 
        
        // 4. RESTITUISCE L'OGGETTO COMPLETO
        return apiResponse; 

    } catch (error) {
        log(`ERRORE durante l'aggiornamento forecast per ${cacheKey}: ${error.message}`, 'Master Fetch Log');
        
        // 4. Gestione del LOCK in caso di errore
        const cachedData = myCache.get(cacheKey);
        
        if (cacheLocks.has(cacheKey)) {
            // Rifiuta la promise del lock con l'errore
            if(typeof rejectLock === 'function') rejectLock(error); 
        }
        
        // Se si è verificato un errore, ma esiste un dato cachato, lo restituiamo come fallback
        if (cachedData) {
            log(`Fallback su dati cachati dopo errore per: ${cacheKey}`, 'Master Fetch Log');
            // Restituisce l'oggetto completo cachato
            return cachedData; 
        }

        // Se non c'è cache e c'è errore, rilanciamo l'errore
        throw error;
    } finally {

        if (cacheLocks.has(cacheKey)) {
            // Rimuove il lock in tutti i casi
            cacheLocks.delete(cacheKey);
        }
    }
}

// Wrapper per retrocompatibilità
const fetchAndProcessForecast = getUnifiedForecastData;

module.exports = { getUnifiedForecastData, fetchAndProcessForecast, myCache };
