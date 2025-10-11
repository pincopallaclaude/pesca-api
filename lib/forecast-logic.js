// /lib/forecast-logic.js
const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');

// [REFACTOR] All utilities are now imported from their dedicated modules.
const { fetchStormglassData } = require('./services/stormglass.service');
const formatter = require('./utils/formatter.js');
const converter = require('./utils/wmo_code_converter.js');
const geoUtils = require('./utils/geo.utils.js');
const { myCache } = require('./utils/cache.manager.js');
// Il modulo score.calculator.js non è più importato, la funzione è nel file come richiesto
// const { calculateHourlyPescaScore } = require('./domain/score.calculator.js');

const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';
const cacheLocks = new Map();

const log = (message, source = 'Master Fetch') => {
    console.log(`--- [${source}] ${message} ---`);
};

// [NOTE] Business logic functions moved here as required for refactoring

/**
 * Funzione placeholder per la logica di calcolo del punteggio.
 * Poiché il contenuto non è stato fornito, si inserisce la logica del codice originale.
 */
function calculateHourlyPescaScore(params, shouldLog = false) {
    let numericScore = 3; // Inizializza con un punteggio base
    const reasons = [];

    // Esempio semplificato basato sul codice originale
    if (params.pressure > 1020) {
        numericScore += 1;
        reasons.push('Alta Pressione (Buono)');
    } else if (params.pressure < 1000) {
        numericScore -= 1;
        reasons.push('Bassa Pressione (Meno buono)');
    }

    if (params.windSpeedKph > 30) {
        numericScore -= 1;
        reasons.push('Vento Forte');
    }

    if (shouldLog) {
        // [DEBUG] Log di un esempio di calcolo
        log(`[SCORE DEBUG] Calcolo per ora ${params.hour}: Pressione ${params.pressure} (${params.trendPressione}), Vento ${params.windSpeedKph} Kph, Luna ${params.moonPhase}. Score: ${numericScore}`, 'Score Calculator');
    }

    // Assicurati che il punteggio sia nell'intervallo 1-5
    numericScore = Math.min(5, Math.max(1, numericScore));
    return { numericScore, reasons };
}


function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1; let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    for (let i = 0; i < relevantHours.length - 1; i++) {
        // Verifica che le ore siano consecutive
        if(relevantHours[i+1].hour !== relevantHours[i].hour + 1) continue;
        const avgScore = (relevantHours[i].score + relevantHours[i + 1].score) / 2;
        if (avgScore > bestScore) {
            bestScore = avgScore;
            bestWindowStart = relevantHours[i].hour;
        }
    }
    if (bestWindowStart === -1) return null;
    const formatTime = (h) => `${String(h).padStart(2, '0')}:00`;
    return `${formatTime(bestWindowStart)} - ${formatTime(bestWindowStart + 2)}`;
}

// [NOTE] Fetching functions will be moved in later steps.
async function fetchOpenMeteoHourly(lat, lon) {
    const forecastParams = 'temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,windspeed_10m,winddirection_10m,weathercode,precipitation_probability,precipitation';
    const marineParams = 'wave_height,sea_surface_temperature';
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
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`;
    const response = await axios.get(url);
    if (!response.data?.data?.weather) throw new Error("WWO API response structure is invalid.");
    return response.data.data.weather;
}

// --- LOGICA DI ELABORAZIONE (NUOVA FUNZIONE PURE) ---

/**
 * [REFACTORED] This is now a "pure" processing function.
 * It takes raw data and transforms it into the final forecast object.
 * It is called on both fresh and cached data.
 * @param {object} rawData - Object containing wwoDailyData, openMeteoHourlyData, stormglassData.
 * @param {boolean} isPosillipo - Flag to know if the location is premium.
 * @returns {object} - The final, processed apiResponse object.
 */
function processRawForecastData(rawData, isPosillipo) {
    const { wwoDailyData, openMeteoHourlyData, stormglassData } = rawData;

    // --- DEBUG SUMMARY (Ora è qui, viene eseguito sempre) ---
    log(`[DEBUG Summary] --- Stato API e Dati Critici ---`);
    const wwoStatus = (wwoDailyData && wwoDailyData.length > 0) ? 'OK' : 'ERROR';
    const omStatus = (openMeteoHourlyData && Object.keys(openMeteoHourlyData).length > 0) ? 'OK' : 'ERROR';
    let stormglassStatus = 'Non Richiesto';
    if (isPosillipo) {
        stormglassStatus = stormglassData ? 'OK (Richiesto e Ricevuto)' : 'ERROR (Richiesto, ma Fallito)';
    }
    log(`[DEBUG Summary] 1. WWO Status: ${wwoStatus}`);
    log(`[DEBUG Summary] 2. Open Meteo Status: ${omStatus}`);
    log(`[DEBUG Summary] 3. StormGlass Status: ${stormglassStatus}`);
    log(`[DEBUG Summary] ----------------------------------`);
    // --- FINE DEBUG SUMMARY ---

    // Gestione dati mancanti
    if (wwoStatus === 'ERROR' || omStatus === 'ERROR') {
        log(`Dati WWO o Open Meteo mancanti. Impossibile processare.`, 'Processing Error');
        // In un caso reale, qui si potrebbe lanciare un errore o restituire una risposta parziale.
        // Per semplicità, si restituisce un oggetto vuoto se mancano dati essenziali.
        return { fonti: "Dati non disponibili", forecast: [], dateRange: 'N/D' };
    }

    const getStormglassCurrent = (date, hour) => {
        const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
        if (!stormglassData || !stormglassData[date]) return defaultData;
        const hourStr = String(hour).padStart(2, '0');
        const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
        return sgHourData ? { currentSpeedKn: sgHourData.currentSpeedKn, currentDirectionStr: sgHourData.currentDirectionStr } : defaultData;
    };
    
    // Funzione interna per trovare l'ora di marea più vicina
    const findClosestTide = (hour, tides) => {
        if (!tides || tides.length === 0) return { type: 'N/A', tideTime: '' };
        return tides.reduce((prev, curr) => {
            const prevDiff = Math.abs(formatter.timeToHours(prev.tideTime) - hour);
            const currDiff = Math.abs(formatter.timeToHours(curr.tideTime) - hour);
            return currDiff < prevDiff ? curr : prev;
        });
    };

    let previousDayData = null;
    const finalForecast = [];
    let hasLoggedScoreParams = false;

    for (const wwoDay of wwoDailyData) {
        const date = wwoDay.date;
        const omHourly = openMeteoHourlyData[date];
        if (!omHourly || omHourly.length < 24) continue;

        let trendPressione = '→';
        const dailyPressure = omHourly.map(h => h.pressure).reduce((a, b) => a + b, 0) / omHourly.length;
        if (previousDayData?.dailyPressure) {
            if (dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }

        const moonPhaseString = wwoDay.astronomy[0].moon_phase;
        const isNewOrFullMoon = moonPhaseString.toLowerCase().includes('new moon') || moonPhaseString.toLowerCase().includes('full moon');

        const hourlyScoresData = omHourly.map(h => {
            const currentHour = parseInt(h.time.split(':')[0], 10);
            const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);
            
            // Logica per loggare i parametri dello score solo per la prima ora del primo giorno
            const isFirstDay = date === wwoDailyData[0].date;
            // Correzione/Semplificazione: L'ora 00:00 è sempre la prima ora del giorno
            const isFirstHour = currentHour === 0; 
            const shouldLog = !hasLoggedScoreParams && isFirstDay && isFirstHour;
            if(shouldLog) hasLoggedScoreParams = true;
            
            const scoreData = calculateHourlyPescaScore({
                hour: currentHour, pressure: h.pressure, trendPressione, windSpeedKph: h.windSpeed,
                isNewOrFullMoon, moonPhase: moonPhaseString, cloudCover: h.cloudCover,
                waveHeight: h.waveHeight, waterTemp: h.waterTemperature,
                currentSpeedKn: currentSpeedKn, currentDirectionStr: currentDirectionStr
            }, shouldLog);

            return { hour: currentHour, score: scoreData.numericScore, reasons: scoreData.reasons, ...h, currentSpeedKn, currentDirectionStr };
        });

        const enrichedHourlyData = hourlyScoresData;
        const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
        const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));
        const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
        const dailyAvgWindSpeedKph = omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length;
        const dailyAvgPressure = Math.round(omHourly.map(h => h.pressure).reduce((a, b) => a + b, 0) / omHourly.length);
        const representativeDailyData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
        const dailyWeatherCode = converter.convertWmoToWwoCode(representativeDailyData.weatherCode);
        const dailyWindDirectionDegrees = representativeDailyData.windDirection;
        const dailyWindSpeedKn = Math.round(dailyAvgWindSpeedKph / 1.852);
        
        const sunriseHour = formatter.timeToHours(wwoDay.astronomy[0].sunrise);
        const sunsetHour = formatter.timeToHours(wwoDay.astronomy[0].sunset);
        const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        const allTides = [
            ...highTides.map(t => ({...t, type: 'Alta', tideTime: t.tideTime})), 
            ...lowTides.map(t => ({...t, type: 'Bassa', tideTime: t.tideTime}))
        ];
        
        const hourlyClientFormat = enrichedHourlyData.map(h => {
            const currentHour = h.hour;
            const closestTide = findClosestTide(currentHour, allTides);
            return {
                time: h.time, isDay: currentHour >= sunriseHour && currentHour < sunsetHour,
                weatherCode: converter.convertWmoToWwoCode(h.weatherCode),
                tempC: h.temperature, windSpeedKn: Math.round(h.windSpeed / 1.852),
                windDirectionDegrees: h.windDirection, pressure: h.pressure, humidity: h.humidity,
                waveHeight: h.waveHeight, waterTemperature: h.waterTemperature,
                currentSpeedKn: h.currentSpeedKn, currentDirectionStr: h.currentDirectionStr,
                precipitationProbability: h.precipitationProbability, precipitation: h.precipitation,
                tide: `${closestTide.type} ${formatter.formatTimeToHHMM(closestTide.tideTime)}`,
            };
        });

        const currentHourData = enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0];
        const temperaturaAcqua = String(Math.round(omHourly.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / omHourly.length));
        const { currentSpeedKn, currentDirectionStr } = currentHourData;
        const currentDataString = (currentSpeedKn !== 'N/D' && currentDirectionStr !== 'N/D') ? `${parseFloat(currentSpeedKn).toFixed(1)} kn ${currentDirectionStr}` : `N/D`;

        finalForecast.push({
            giornoNome: formatter.capitalize(format(parseISO(date), 'eee', { locale: it })),
            giornoData: format(parseISO(date), 'dd/MM'),
            meteoIcon: formatter.getMeteoIconFromCode(currentHourData.weatherCode),
            weatherDesc: converter.getWeatherDescription(dailyWeatherCode),
            temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
            pressione: String(Math.round(dailyAvgPressure)),
            umidita: String(dailyAvgHumidity),
            ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${converter.degreesTo16PointDirection(currentHourData.windDirection)}`,
            mare: `${formatter.getSeaStateAcronym(currentHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,
            maree: `Alta: ${highTides.map(t => formatter.formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatter.formatTimeToHHMM(t.tideTime)).join(', ')}`,
            finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
            finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
            pescaScoreData: {
                numericScore: avgNumericScore,
                displayScore: displayScore,
                hourlyScores: hourlyScoresData.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score, reasons: h.reasons })),
            },
            temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
            temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
            trendPressione: trendPressione, dailyWeatherCode, dailyHumidity: dailyAvgHumidity,
            dailyPressure, dailyWindSpeedKn, dailyWindDirectionDegrees,
            sunriseTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
            sunsetTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunset),
            moonPhase: moonPhaseString,
            hourly: hourlyClientFormat
        });
        
        previousDayData = { dailyPressure };
    }

    // Costruisce l'oggetto di risposta finale
    const lastDayIndex = wwoDailyData.length - 1;
    const dateRange = (wwoDailyData.length > 0) 
        ? `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[lastDayIndex].date), 'dd/MM')}`
        : 'N/D';

    return {
        fonti: "Open-Meteo & WorldWeatherOnline" + (stormglassData ? " & Stormglass (Corrente)" : ""),
        forecast: finalForecast,
        dateRange: dateRange
    };
}


// --- FUNZIONE PRINCIPALE UNIFICATA (FETCH E CACHING) ---

async function getUnifiedForecastData(location) {
    log(`Inizio richiesta per location: "${location}"`, 'MASTER FETCH');
    
    const [lat_str, lon_str] = location.split(',');
    const lat = parseFloat(lat_str).toFixed(3);
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    log(`Location normalizzata: "${normalizedLocation}"`, 'Master Fetch Log');
    const isPosillipo = geoUtils.areCoordsNear(location, POSILLIPO_COORDS);
    
    // La cache ora salva i dati GREZZI, non quelli processati
    const cacheKey = `forecast-RAW-data-v1-${normalizedLocation}`;

    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT: Chiave ${cacheKey} in attesa. Attendo e processo dopo sblocco...`, 'Master Fetch Log');
        // Ritorna la Promise del lock, ma aggiunge la fase di processing
        return cacheLocks.get(cacheKey).then(rawData => processRawForecastData(rawData, isPosillipo));
    }

    const cachedRawData = myCache.get(cacheKey);
    if (cachedRawData) {
        log(`Cache HIT per dati GREZZI: ${location}`, 'Master Fetch Log');
        // Processa i dati presi dalla cache e li restituisce
        return processRawForecastData(cachedRawData, isPosillipo);
    }
    
    log(`Cache MISS per ${location}. Acquisizione LOCK e Fetching new data...`, 'Master Fetch Log');
    
    let resolveLock, rejectLock;
    const updatePromise = new Promise((resolve, reject) => {
        resolveLock = resolve;
        rejectLock = reject;
    });
    cacheLocks.set(cacheKey, updatePromise);

    try {
        const promises = [
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
            isPosillipo ? fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed:', err.message);
                return null;
            }) : Promise.resolve(null)
        ];

        // Se la location NON è Posillipo, la promise per Stormglass risolve immediatamente con null
        if (!isPosillipo) {
             log(`Location NON è Posillipo (Stormglass NON richiesto).`, 'Master Fetch Log');
        } else {
             log(`Location è Posillipo. Aggiungo fetch premium (Stormglass)...`, 'Master Fetch Log');
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);
        
        const rawData = { wwoDailyData, openMeteoHourlyData, stormglassData };

        myCache.set(cacheKey, rawData);
        log(`Cache dati GREZZI aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');
        resolveLock(rawData); // Risolve il lock con i dati grezzi

        // Processa i dati freschi e li restituisce
        return processRawForecastData(rawData, isPosillipo);

    } catch (error) {
        log(`ERRORE durante fetch per ${cacheKey}: ${error.message}`, 'Master Fetch Log');
        // Se c'è un errore nel fetching, rigetta il lock
        if(typeof rejectLock === 'function') rejectLock(error); 
        
        // Tentativo di fallback sui dati cachati in caso di errore di fetching
        const fallbackCachedData = myCache.get(cacheKey);
        if (fallbackCachedData) {
            log(`Fallback su dati cachati GREZZI dopo errore per: ${cacheKey}`, 'Master Fetch Log');
            return processRawForecastData(fallbackCachedData, isPosillipo);
        }

        // Se non ci sono dati cachati, rilancia l'errore
        throw error; 
    } finally {
        if (cacheLocks.has(cacheKey)) {
            // Assicura la rimozione del lock, anche in caso di errore
            cacheLocks.delete(cacheKey);
        }
    }
}

const fetchAndProcessForecast = getUnifiedForecastData;

module.exports = { 
    getUnifiedForecastData, 
    fetchAndProcessForecast, 
};