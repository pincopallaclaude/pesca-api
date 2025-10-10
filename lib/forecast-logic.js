// /lib/forecast-logic.js
const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');
// ** ASSICURARSI CHE IL SERVIZIO DI STORMGLASS SIA STATO CORRETTO **
const { fetchStormglassData } = require('./services/stormglass.service');

// [REFACTOR] Importing utilities from their dedicated modules.
const {
    capitalize, getSeaStateAcronym, formatTimeToHHMM, getMeteoIconFromCode, getStatusLabel
} = require('./utils/formatter.js');
const {
    convertWmoToWwoCode, degreesTo16PointDirection, areCoordsNear, getWeatherDescription
} = require('./utils/wmo_code_converter.js');


const myCache = new NodeCache({ stdTTL: 21600 });
// Coordinate esatte di Posillipo
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';
const cacheLocks = new Map();

/**
 * Funzione centralizzata di logging. Stampa sulla console del backend.
 * @param {string} message - Messaggio di log.
 * @param {string} source - Sorgente del log (es. 'Master Fetch', 'DEBUG Summary').
 */
const log = (message, source = 'Master Fetch') => {
    const fullMessage = `--- [${source}] ${message} ---`;
    console.log(fullMessage);
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
        pressure, trendPressione, windSpeedKph, isNewOrFullMoon, moonPhase, // AGGIUNTO moonPhase
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
        
        // NUOVA LOGICA DI LOG PER LA LUNA
        let moonLogStatus = 'NO';
        if (isNewOrFullMoon) {
            moonLogStatus = 'SI';
        } else if (moonPhase) {
            // Se non è critica, aggiungiamo il motivo esatto
            moonLogStatus = `NO (${moonPhase})`;
        }


        // Stampa il riepilogo richiesto, reso più evidente
        console.log(`\n======================================================`);
        console.log(`[Score Calc DEBUG] Parametri Ricevuti per il calcolo (Prima Ora):`);
        console.log(`  - Pressione/Trend: ${pressureStatus} / ${trendStatus}`);
        console.log(`  - Vento: ${windStatus}`);
        console.log(`  - Nuvolosità: ${cloudStatus}`);
        console.log(`  - Onde (WaveHeight): ${waveStatus}`);
        console.log(`  - Temp Acqua: ${tempWaterStatus}`);
        console.log(`  - Corrente (Speed/Dir): ${currentStatus} / ${currentDirStatus}`);
        console.log(`  - Luna (Fase Critica): ${moonLogStatus}`); // UTILIZZO LA NUOVA VARIABILE
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
    let currentText = "Corrente N/D (Non Richiesto)"; // MESSAGGIO STANDARD

    // Verifica la disponibilità dei dati di corrente
    if (currentSpeedKn !== 'N/D') {
        // I dati sono disponibili, quindi la richiesta è andata a buon fine.
        let currentType = "neutral";
        let currentIcon = "swap_horiz";
        
        // Convertiamo in float prima di valutare l'intervallo
        const speed = parseFloat(currentSpeedKn);
        
        if (speed > 0.3 && speed <= 0.8) {
            currentPoints = 1.0; currentText = "Corrente ideale (0.3-0.8 kn)"; currentType = "positive";
        } else if (speed > 0.8) {
            currentPoints = -1.0; currentText = "Corrente forte (>0.8 kn)"; currentType = "negative";
        } else { // speed <= 0.3 kn
            currentText = "Corrente debole/nulla"; 
        }

        score += currentPoints;
        reasons.push({ 
            icon: currentIcon, 
            text: currentText, 
            points: currentPoints >= 0 ? `+${currentPoints.toFixed(1)}` : currentPoints.toFixed(1), 
            type: currentType 
        });

    } else {
         // I dati non sono disponibili ('N/D'), o perché non richiesti (non Posillipo) o per fallimento.
         // Non aggiungiamo punti e usiamo il testo di default 'Corrente N/D (Non Richiesto)'
         reasons.push({ 
            icon: 'swap_horiz', 
            text: currentText, 
            points: '+0.0', 
            type: 'neutral' 
        });
    }
    
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

// --- FUNZIONE PRINCIPALE UNIFICATA ---
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
    // Usiamo le coordinate arrotondate (toFixed(3)) per uniformare la richiesta
    const lat = parseFloat(lat_str).toFixed(3); // 3 cifre decimali ~ 111 metri di precisione
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    log(`Location normalizzata a 3 decimali: "${normalizedLocation}"`, 'Master Fetch Log');

    // Check se la location è vicina a Posillipo (Tollesanza 1 km)
    const isPosillipo = utilities.areCoordsNear(location, POSILLIPO_COORDS);
    
    // CHIAVE: Usiamo la location normalizzata per la chiave della cache
    const cacheKey = `forecast-data-v-ULTIMA-PROVA-1-${normalizedLocation}`;
    
    // ------------------- LOGICA DI CACHE LOCKING -------------------
    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT: Chiave ${cacheKey} in fase di aggiornamento. Attendo...`, 'Master Fetch Log');
        return cacheLocks.get(cacheKey);
    }

    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            log(`Cache HIT for ${location}`, 'Master Fetch Log');
            return cachedData; 
        }

        log(`Cache MISS for ${location}. Acquisizione LOCK e Fetching new data...`, 'Master Fetch Log');
        
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
        
        let stormglassData = null; // Inizializziamo a null di default
        
        // ==========================================================
        // *** LOGICA DI RESTRZIONE API: SOLO POSILLIPO ***
        // ==========================================================
        if (isPosillipo) {
            log(`Location è Posillipo (entro 1km). Aggiungo fetch premium (Stormglass)...`, 'Master Fetch Log');
            
            // Aggiungiamo la Promise a parte, in modo che Promise.all risolva solo le prime due.
            // Passiamo l'oggetto utilities completo al servizio.
            const stormglassPromise = fetchStormglassData(lat, lon, utilities).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed (Controllare log del catch):', err.message);
                return null; 
            });
            promises.push(stormglassPromise);
        } else {
             // LOG AGGIORNATO: Ora specifichiamo perché NON viene inviata la richiesta
            log(`Location NON è Posillipo (Stormglass NON richiesto).`, 'Master Fetch Log');
             // Per coerenza con Promise.all, aggiungiamo una Promise che risolve a null
            promises.push(Promise.resolve(null)); 
        }
        // ==========================================================

        // Recuperiamo i dati. L'ultima variabile in 'await' sarà stormglassData o null.
        const [wwoDailyData, openMeteoHourlyData, sgData] = await Promise.all(promises);
        stormglassData = sgData; // Assegniamo il risultato (può essere null)
        
        // ==========================================================
        // ✨ DEBUG: Riepilogo Stato API 
        // ==========================================================
        let stormglassStatus;
        let criticalDataWarning = '';
        
        const wwoStatus = (wwoDailyData && wwoDailyData.length > 0) ? 'OK' : 'ERROR: Dati WWO mancanti';
        const omStatus = (openMeteoHourlyData && Object.keys(openMeteoHourlyData).length > 0) ? 'OK' : 'ERROR: Dati OpenMeteo mancanti';

        if (isPosillipo) {
            if (stormglassData) { 
                stormglassStatus = 'OK (Richiesto e Ricevuto)';
            } else {
                stormglassStatus = 'ERROR (Richiesto, ma Fallito)';
                criticalDataWarning = 'Stormglass ha fallito, Corrente/Acqua N/D.';
            }
        } else {
            stormglassStatus = 'Non Richiesto';
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
            // Se non è Posillipo (o se SGData è null per fallimento), restituiamo N/D
            const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
            if (!stormglassData || !stormglassData[date]) return defaultData; 
            
            const hourStr = String(hour).padStart(2, '0');
            const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
            
            return sgHourData ? { 
                currentSpeedKn: sgHourData.currentSpeedKn, 
                currentDirectionStr: sgHourData.currentDirectionStr 
            } : defaultData;
        };

        let previousDayData = null;
        const finalForecast = [];
        
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

            // Nuova variabile per la fase lunare
            const moonPhaseString = wwoDay.astronomy[0].moon_phase;
            const isNewOrFullMoon = moonPhaseString.toLowerCase().includes('new moon') || moonPhaseString.toLowerCase().includes('full moon');
            
            const hourlyScoresData = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                
                // 1. Otteniamo i dati di corrente (saranno N/D se non era Posillipo)
                const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);

                // Determina se questa è l'ora in cui eseguire il log di debug
                const isFirstDay = date === wwoDailyData[0].date;
                const isFirstHour = currentHour === parseInt(omHourly[0].time.split(':')[0], 10);

                const shouldLog = !hasLoggedScoreParams && isFirstDay && isFirstHour;
                
                if(shouldLog) hasLoggedScoreParams = true; // Imposta il flag dopo il primo check
                
                // 2. Calcoliamo lo score
                const scoreData = calculateHourlyPescaScore({
                    hour: currentHour,
                    pressure: h.pressure,
                    trendPressione,
                    windSpeedKph: h.windSpeed,
                    isNewOrFullMoon,
                    moonPhase: moonPhaseString, // PASSATO ALLA FUNZIONE
                    cloudCover: h.cloudCover,
                    waveHeight: h.waveHeight,
                    waterTemp: h.waterTemperature,
                    currentSpeedKn: currentSpeedKn, 
                    currentDirectionStr: currentDirectionStr 
                }, shouldLog); 

                // 3. Ritorniamo l'oggetto unificato
                return {
                    hour: currentHour,
                    score: scoreData.numericScore,
                    reasons: scoreData.reasons,
                    ...h,
                    currentSpeedKn,
                    currentDirectionStr,
                };
            });
            
            const enrichedHourlyData = hourlyScoresData;
            
            const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
            const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));

            const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
            const dailyAvgWindSpeedKph = omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length;
            const dailyAvgPressure = Math.round(omHourly.map(h => h.pressure).reduce((a,b)=>a+b,0) / omHourly.length);

            const representativeDailyData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
            const dailyWeatherCode = convertWmoToWwoCode(representativeDailyData.weatherCode);

            const dailyWindDirectionDegrees = representativeDailyData.windDirection;
            const dailyWindSpeedKn = Math.round(dailyAvgWindSpeedKph / 1.852); 
            
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
                const currentHour = h.hour; 
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
                    currentSpeedKn: h.currentSpeedKn, 
                    currentDirectionStr: h.currentDirectionStr, 
                    precipitationProbability: h.precipitationProbability,
                    precipitation: h.precipitation,
                    tide: `${closestTide.type} ${formatTimeToHHMM(closestTide.tideTime)}`,
                };
            });

            const currentHourData = enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0];
            
            const temperaturaAcqua = String(Math.round(omHourly.map(h=>h.waterTemperature).reduce((a,b)=>a+b,0) / omHourly.length));
            
            const currentSpeedKn = currentHourData.currentSpeedKn;
            const currentDirectionStr = currentHourData.currentDirectionStr;

            const currentDataString = 
                (currentSpeedKn !== 'N/D' && currentDirectionStr !== 'N/D')
                ? `${parseFloat(currentSpeedKn).toFixed(1)} kn ${currentDirectionStr}`
                : `N/D`;

            finalForecast.push({
                // ---- SEZIONE 1: Dati usati da MainHeroModule (stringhe formattate) ----
                giornoNome: capitalizeLocal(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                weatherDesc: getWeatherDescription(dailyWeatherCode),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
                pressione: String(Math.round(dailyAvgPressure)),
                umidita: String(dailyAvgHumidity),
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirectionLocal(currentHourData.windDirection)}`,
                
                // Mare: stato mare (acronimo) + temp. acqua + velocità/direzione corrente (gestione pulita N/D)
                mare: `${getSeaStateAcronym(currentHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,

                maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
                
                finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
                finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
                
                // ---- SEZIONE 2: Dati di pesca (Con la nuova struttura) ----
                pescaScoreData: {
                    numericScore: avgNumericScore,
                    displayScore: displayScore,
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
                moonPhase: moonPhaseString,
                hourly: hourlyClientFormat
            });

            previousDayData = { dailyPressure };
        }

        const apiResponse = {
            fonti: "Open-Meteo & WorldWeatherOnline" + (stormglassData ? " & Stormglass (Corrente)" : ""),
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        // 2. Scrittura in cache
        myCache.set(cacheKey, apiResponse);
        
        log(`Cache aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');

        // 3. Rilascio del LOCK
        resolveLock(apiResponse); 
        
        // 4. RESTITUISCE L'OGGETTO COMPLETO
        return apiResponse; 

    } catch (error) {
        log(`ERRORE durante l'aggiornamento forecast per ${cacheKey}: ${error.message}`, 'Master Fetch Log');
        
        const cachedData = myCache.get(cacheKey);
        
        if (cacheLocks.has(cacheKey)) {
            if(typeof rejectLock === 'function') rejectLock(error); 
        }
        
        if (cachedData) {
            log(`Fallback su dati cachati dopo errore per: ${cacheKey}`, 'Master Fetch Log');
            return cachedData; 
        }

        throw error;
    } finally {

        if (cacheLocks.has(cacheKey)) {
            cacheLocks.delete(cacheKey);
        }
    }
}

const fetchAndProcessForecast = getUnifiedForecastData;

module.exports = { 
    getUnifiedForecastData, 
    fetchAndProcessForecast, 
    myCache,
    utilities 
};