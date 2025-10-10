// /lib/forecast-logic.js

const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');
const { fetchStormglassData } = require('./services/stormglass.service');

// [REFACTOR] Importing utilities from dedicated, specialized modules.
const formatter = require('./utils/formatter');
const weatherUtils = require('./utils/wmo_code_converter');

const myCache = new NodeCache({ stdTTL: 21600 });
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

// [REFACTOR] Deconstructing the imported functions for local use.
const { areCoordsNear, getStatusLabel, degreesTo16PointDirection, convertWmoToWwoCode } = weatherUtils;
const { capitalize, formatTimeToHHMM, getSeaStateAcronym, getWeatherDescription, getMeteoIconFromCode } = formatter;

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
        pressure, trendPressione, windSpeedKph, isNewOrFullMoon, moonPhase,
        cloudCover, waveHeight, waterTemp, currentSpeedKn,
        currentDirectionStr, hour
    } = params;
    
    if (shouldLog) {
        const pressureStatus = getStatusLabel(pressure);
        const trendStatus = getStatusLabel(trendPressione);
        const windStatus = getStatusLabel(windSpeedKph);
        const cloudStatus = getStatusLabel(cloudCover);
        const waveStatus = getStatusLabel(waveHeight);
        const tempWaterStatus = getStatusLabel(waterTemp);
        const currentStatus = (currentSpeedKn === 'N/D') ? 'N/D' : getStatusLabel(currentSpeedKn);
        const currentDirStatus = (currentDirectionStr === 'N/D') ? 'N/D' : getStatusLabel(currentDirectionStr);
        let moonLogStatus = 'NO';
        if (isNewOrFullMoon) { moonLogStatus = 'SI'; } 
        else if (moonPhase) { moonLogStatus = `NO (${moonPhase})`; }

        console.log(`\n======================================================`);
        console.log(`[Score Calc DEBUG] Parametri Ricevuti per il calcolo (Prima Ora):`);
        console.log(`  - Pressione/Trend: ${pressureStatus} / ${trendStatus}`);
        console.log(`  - Vento: ${windStatus}`);
        console.log(`  - Nuvolosità: ${cloudStatus}`);
        console.log(`  - Onde (WaveHeight): ${waveStatus}`);
        console.log(`  - Temp Acqua: ${tempWaterStatus}`);
        console.log(`  - Corrente (Speed/Dir): ${currentStatus} / ${currentDirStatus}`);
        console.log(`  - Luna (Fase Critica): ${moonLogStatus}`);
        console.log(`======================================================\n`);
    }

    if (trendPressione === '↓') { score += 1.5; reasons.push({ icon: 'pressure_down', text: "Pressione in calo", points: "+1.5", type: "positive" }); }
    else if (trendPressione === '↑') { score -= 1.0; reasons.push({ icon: 'pressure_up', text: "Pressione in aumento", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'pressure', text: "Pressione stabile", points: "+0.0", type: "neutral" }); }

    if (windSpeedKph > 5 && windSpeedKph < 20) { score += 1.0; reasons.push({ icon: 'wind', text: "Vento ideale (5-20 km/h)", points: "+1.0", type: "positive" }); }
    else if (windSpeedKph > 30) { score -= 2.0; reasons.push({ icon: 'wind', text: "Vento forte (>30 km/h)", points: "-2.0", type: "negative" }); }
    else { reasons.push({ icon: 'wind', text: "Vento debole/variabile", points: "+0.0", type: "neutral" }); }

    if (isNewOrFullMoon) { score += 1.0; reasons.push({ icon: 'moon', text: "Luna Nuova o Piena", points: "+1.0", type: "positive" }); }
    else { reasons.push({ icon: 'moon', text: "Fase lunare neutra", points: "+0.0", type: "neutral" }); }

    if (cloudCover > 60) { score += 1.0; reasons.push({ icon: 'clouds', text: "Coperto >60%", points: "+1.0", type: "positive" }); }
    else if (cloudCover < 20 && pressure > 1018) { score -= 1.0; reasons.push({ icon: 'clouds', text: "Sereno con alta pressione", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'clouds', text: "Nuvolosità neutra", points: "+0.0", type: "neutral" }); }

    if (waveHeight != null) { 
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    } else {
        reasons.push({ icon: 'waves', text: "Dati onde non disp.", points: "+0.0", type: "neutral" });
    }

    if (waterTemp != null) {
        if (waterTemp >= 12 && waterTemp <= 20) { score += 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); }
        else if (waterTemp < 10 || waterTemp > 24) { score -= 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); }
        else { reasons.push({ icon: 'water_temp', text: "Temp. acqua neutra", points: "+0.0", type: "neutral" }); }
    } else {
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
    }
    
    let currentPoints = 0.0;
    let currentText = "Corrente N/D (Non Richiesto)";
    if (currentSpeedKn !== 'N/D') {
        let currentType = "neutral";
        const speed = parseFloat(currentSpeedKn);
        if (speed > 0.3 && speed <= 0.8) { currentPoints = 1.0; currentText = "Corrente ideale (0.3-0.8 kn)"; currentType = "positive"; }
        else if (speed > 0.8) { currentPoints = -1.0; currentText = "Corrente forte (>0.8 kn)"; currentType = "negative"; }
        else { currentText = "Corrente debole/nulla"; }
        score += currentPoints;
        reasons.push({ icon: 'swap_horiz', text: currentText, points: `${currentPoints >= 0 ? '+' : ''}${currentPoints.toFixed(1)}`, type: currentType });
    } else {
         reasons.push({ icon: 'swap_horiz', text: currentText, points: '+0.0', type: 'neutral' });
    }
    
    return { numericScore: score, reasons: reasons };
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1; let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    
    for (let i = 0; i < relevantHours.length - 1; i++) {
        if (relevantHours[i+1].hour !== relevantHours[i].hour + 1) continue;
        const avgScore = (relevantHours[i].score + relevantHours[i + 1].score) / 2;
        if (avgScore > bestScore) {
            bestScore = avgScore;
            bestWindowStart = relevantHours[i].hour;
        }
    }
    
    if (bestWindowStart === -1) return null;
    const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
    return `${formatHour(bestWindowStart)} - ${formatHour(bestWindowStart + 2)}`; 
}

// --- SEZIONE FETCHING DATI DALLE API ---
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
            waveHeight: marineApiData.wave_height ? marineApiData.wave_height[i] : null,
            waterTemperature: marineApiData.sea_surface_temperature ? marineApiData.sea_surface_temperature[i] : null,
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

// --- FUNZIONE PRINCIPALE UNIFICATA ---
async function getUnifiedForecastData(location) {
    log(`Inizio richiesta per location: "${location}"`, 'MASTER FETCH');
    const [lat_str, lon_str] = location.split(',');
    const lat = parseFloat(lat_str).toFixed(3);
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    log(`Location normalizzata a 3 decimali: "${normalizedLocation}"`, 'Master Fetch Log');

    const isPosillipo = areCoordsNear(location, POSILLIPO_COORDS);
    const cacheKey = `forecast-data-v-ULTIMA-PROVA-1-${normalizedLocation}`;

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
        
        let resolveLock, rejectLock;
        const updatePromise = new Promise((resolve, reject) => {
            resolveLock = resolve;
            rejectLock = reject;
        });
        cacheLocks.set(cacheKey, updatePromise);

        const promises = [ fetchWwoDaily(lat, lon), fetchOpenMeteoHourly(lat, lon) ];
        if (isPosillipo) {
            log(`Location è Posillipo (entro 1km). Aggiungo fetch premium (Stormglass)...`, 'Master Fetch Log');
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed:', err.message);
                return null;
            }));
        } else {
            log(`Location NON è Posillipo (Stormglass NON richiesto).`, 'Master Fetch Log');
            promises.push(Promise.resolve(null));
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);

        const getStormglassCurrent = (date, hour) => {
            const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
            if (!stormglassData || !stormglassData[date]) return defaultData;
            const hourStr = String(hour).padStart(2, '0');
            const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
            return sgHourData || defaultData;
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
            
            const moonPhaseString = wwoDay.astronomy[0].moon_phase;
            const isNewOrFullMoon = moonPhaseString.toLowerCase().includes('new moon') || moonPhaseString.toLowerCase().includes('full moon');
            
            const hourlyScoresData = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);
                const shouldLog = !hasLoggedScoreParams && (date === wwoDailyData[0].date) && (currentHour === parseInt(omHourly[0].time.split(':')[0], 10));
                if(shouldLog) hasLoggedScoreParams = true;
                
                const scoreData = calculateHourlyPescaScore({
                    hour: currentHour, pressure: h.pressure, trendPressione, windSpeedKph: h.windSpeed, isNewOrFullMoon, moonPhase: moonPhaseString,
                    cloudCover: h.cloudCover, waveHeight: h.waveHeight, waterTemp: h.waterTemperature, currentSpeedKn, currentDirectionStr
                }, shouldLog);
                
                return { hour: currentHour, score: scoreData.numericScore, reasons: scoreData.reasons, ...h, currentSpeedKn, currentDirectionStr };
            });
            
            const enrichedHourlyData = hourlyScoresData;
            const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
            const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));
            
            const representativeDailyData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
            
            const timeToHours = (t) => {
                const p = String(t).match(/(\d+):(\d+)\s*(AM|PM)?/); if (!p) return 0;
                let h = parseInt(p[1], 10); if (p[3] === 'PM' && h !== 12) h += 12; if (p[3] === 'AM' && h === 12) h = 0; return h;
            };
            const sunriseHour = timeToHours(wwoDay.astronomy[0].sunrise);
            const sunsetHour = timeToHours(wwoDay.astronomy[0].sunset);

            const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
            const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
            const allTides = [...highTides.map(t => ({...t, type: 'Alta'})), ...lowTides.map(t => ({...t, type: 'Bassa'}))];
            
            const hourlyClientFormat = enrichedHourlyData.map(h => {
                const closestTide = allTides.reduce((p, c) => (Math.abs(timeToHours(p.tideTime) - h.hour) < Math.abs(timeToHours(c.tideTime) - h.hour) ? p : c));
                return {
                    time: h.time, isDay: h.hour >= sunriseHour && h.hour < sunsetHour, weatherCode: convertWmoToWwoCode(h.weatherCode), tempC: h.temperature,
                    windSpeedKn: Math.round(h.windSpeed / 1.852), windDirectionDegrees: h.windDirection, pressure: h.pressure, humidity: h.humidity,
                    waveHeight: h.waveHeight, waterTemperature: h.waterTemperature, currentSpeedKn: h.currentSpeedKn, currentDirectionStr: h.currentDirectionStr,
                    precipitationProbability: h.precipitationProbability, precipitation: h.precipitation, tide: `${closestTide.type} ${formatTimeToHHMM(closestTide.tideTime)}`,
                };
            });

            const currentHourData = enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0];
            const avgWaterTemp = String(Math.round(omHourly.map(h=>h.waterTemperature || 0).reduce((a,b)=>a+b,0) / omHourly.length));
            const currentDataString = (currentHourData.currentSpeedKn !== 'N/D' && currentHourData.currentDirectionStr !== 'N/D') ? `${parseFloat(currentHourData.currentSpeedKn).toFixed(1)} kn ${currentHourData.currentDirectionStr}` : `N/D`;

            finalForecast.push({
                giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                weatherDesc: getWeatherDescription(convertWmoToWwoCode(representativeDailyData.weatherCode)),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a,b)=>a+b,0) / omHourly.length)),
                pressione: String(Math.round(enrichedHourlyData.map(h=>h.pressure).reduce((a,b)=>a+b,0) / enrichedHourlyData.length)),
                umidita: String(Math.round(enrichedHourlyData.map(h => h.humidity).reduce((a, b) => a + b, 0) / enrichedHourlyData.length)),
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(currentHourData.windDirection)}`,
                mare: `${getSeaStateAcronym(currentHourData.waveHeight)} ${avgWaterTemp}° ${currentDataString}`,
                altaMarea: highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', '), // Added for new structure
                bassaMarea: lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', '),  // Added for new structure
                finestraMattino: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D",
                finestraSera: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D",
                pescaScoreNumeric: avgNumericScore,
                hourlyScores: hourlyScoresData.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score, reasons: h.reasons })),
                maxTempC: Math.max(...omHourly.map(h => h.temperature)),
                minTempC: Math.min(...omHourly.map(h => h.temperature)),
                sunriseTime: formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
                sunsetTime: formatTimeToHHMM(wwoDay.astronomy[0].sunset),
                moonPhase: moonPhaseString,
                hourly: hourlyClientFormat
            });

            previousDayData = { dailyPressure };
        }

        const apiResponse = {
            fonti: "Open-Meteo & WWO" + (stormglassData ? " & Stormglass" : ""),
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        myCache.set(cacheKey, apiResponse);
        log(`Cache aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');
        resolveLock(apiResponse); 
        return apiResponse; 
    } catch (error) {
        log(`ERRORE durante l'aggiornamento forecast per ${cacheKey}: ${error.message}`, 'Master Fetch Log');
        const cachedData = myCache.get(cacheKey);
        if (cacheLocks.has(cacheKey) && typeof rejectLock === 'function') rejectLock(error);
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
    myCache
};