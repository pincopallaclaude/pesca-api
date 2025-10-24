// /lib/forecast-logic.js

import axios from 'axios';
import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale/index.js';

// [REFACTOR] All utilities are now imported from their dedicated modules.
import { fetchStormglassData } from './services/stormglass.service.js';
import * as formatter from './utils/formatter.js';
import * as converter from './utils/wmo_code_converter.js';
import * as geoUtils from './utils/geo.utils.js';
import { myCache } from './utils/cache.manager.js';
import { calculateHourlyPescaScore } from './domain/score.calculator.js';
import { runProactiveAnalysis } from './services/proactive_analysis.service.js';
import { POSILLIPO_COORDS } from './utils/constants.js'; // NUOVO IMPORT da constants

console.log("--- [DEBUG] Imported geoUtils object:", geoUtils);

const cacheLocks = new Map();

const log = (message, source = 'Master Fetch') => {
    console.log(`--- [${source}] ${message} ---`);
};

/**
 * Funzione di utilità per risolvere una location testuale o coordinate in { lat, lon, name }.
 * Utilizza la funzione fetch nativa di Node.js (disponibile da v18+).
 * @param {string} location - Nome della località (es. "Posillipo") o coordinate ("lat,lon").
 * @returns {Promise<{lat: number, lon: number, name: string}>} Oggetto con coordinate e nome risolto.
 */
async function resolveLocationToCoords(location) {
    const locationLower = location.toLowerCase().trim();

    // [MODIFICA] Special Case: Posillipo, usa le coordinate hardcoded per bypassare il geocoding
    if (locationLower === 'posillipo' || locationLower === 'posillipo, napoli') {
        const [lat, lon] = POSILLIPO_COORDS.split(',').map(parseFloat);
        log(`[Geocoding] ✅ Risolto Special Case: Posillipo → ${lat}, ${lon}`, 'Master Fetch Log');
        return { lat, lon, name: 'Posillipo, Napoli' }; 
    }

    // 1. Caso: Location è già in formato "lat,lon"
    if (location.includes(',')) {
        const [lat, lon] = location.split(',').map(parseFloat);
        if (!isNaN(lat) && !isNaN(lon)) {
            // Per le coordinate, usiamo le coordinate stesse come 'name' temporaneo
            return { lat, lon, name: location }; 
        }
    }

    // 2. Caso: Location è un nome testuale (Geocoding)
    log(`[Geocoding] Risolvo "${location}"...`, 'Master Fetch Log');
    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

    if (!GEOAPIFY_API_KEY) {
        throw new Error('GEOAPIFY_API_KEY mancante per il geocoding. Usare solo coordinate "lat,lon" o impostare la chiave API.');
    }

    // Usiamo fetch nativo di Node.js
    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(location)}&apiKey=${GEOAPIFY_API_KEY}`;
    
    try {
        // La funzione 'fetch' è ora globale, non richiede import esplicito di 'node-fetch'
        const response = await fetch(url, { timeout: 15000 });
        const data = await response.json();

        if (!data.features || data.features.length === 0) {
            throw new Error(`Località "${location}" non trovata tramite Geocoding.`);
        }

        const coords = data.features[0].geometry.coordinates;
        const lat = coords[1]; // Geoapify usa [lon, lat]
        const lon = coords[0];
        const name = data.features[0].properties.formatted;

        log(`[Geocoding] ✅ Risolto: ${name} → ${lat}, ${lon}`, 'Master Fetch Log');
        return { lat, lon, name };
    } catch (error) {
        log(`[Geocoding] ERRORE risoluzione località: ${error.message}`, 'Master Fetch Log');
        throw new Error(`Impossibile risolvere la località. ${error.message}`);
    }
}


/**
 * Analizza 24 codici meteo orari e restituisce il più significativo.
 * La priorità è: Temporale > Neve > Pioggia > Nuvoloso > Sereno.
 * @param {Array<number>} hourlyWmoCodes - Un array di 24 codici WMO.
 * @returns {number} Il codice WMO più significativo.
 */
function getMostSignificantWeatherCode(hourlyWmoCodes) {
    // ... (la logica interna di questa funzione non cambia)
    const priorityOrder = [
        95, 96, 99, 71, 73, 75, 77, 85, 86, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82,
        3, 2, 1, 0
    ];
    for (const code of priorityOrder) {
        if (hourlyWmoCodes.includes(code)) {
            return code;
        }
    }
    return hourlyWmoCodes[12] || hourlyWmoCodes[0];
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    // ... (la logica interna di questa funzione non cambia)
    let bestScore = -1; let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    for (let i = 0; i < relevantHours.length - 1; i++) {
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

async function fetchOpenMeteoHourly(lat, lon) {
    // ... (la logica interna di questa funzione non cambia)
    console.time("PERF: fetchOpenMeteoHourly");
    const forecastParams = 'temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,windspeed_10m,winddirection_10m,weathercode,precipitation_probability,precipitation';
    const marineParams = 'wave_height,sea_surface_temperature';
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${forecastParams}&forecast_days=7`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineParams}&forecast_days=7`;
    const timeoutConfig = { timeout: 15000 };
    try {
        const [forecastResponse, marineResponse] = await Promise.all([
            axios.get(forecastUrl, timeoutConfig),
            axios.get(marineUrl, timeoutConfig)
        ]);
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
    } finally {
        console.timeEnd("PERF: fetchOpenMeteoHourly");
    }
}

async function fetchWwoDaily(lat, lon) {
    // ... (la logica interna di questa funzione non cambia)
    console.time("PERF: fetchWwoDaily");
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`;
    try {
        const response = await axios.get(url, { timeout: 15000 });
        if (!response.data?.data?.weather) throw new Error("WWO API response structure is invalid.");
        return response.data.data.weather;
    } finally {
        console.timeEnd("PERF: fetchWwoDaily");
    }
}

async function getUnifiedForecastData(location) {
    log(`Inizio richiesta per location: "${location}"`, 'MASTER FETCH');

    // NUOVO: Risolviamo la location (nome o coordinate) prima di tutto
    let resolved;
    try {
        resolved = await resolveLocationToCoords(location);
    } catch (e) {
        // Se il geocoding fallisce, lanciamo l'errore
        throw new Error(`Impossibile risolvere la località. ${e.message}`);
    }
    
    // Usiamo le coordinate risolte
    const lat = resolved.lat.toFixed(3);
    const lon = resolved.lon.toFixed(3);
    const resolvedName = resolved.name;

    const normalizedLocation = `${lat},${lon}`;
    log(`Location normalizzata a 3 decimali: "${normalizedLocation}"`, 'Master Fetch Log');
    
    // USIAMO le coordinate originali di Posillipo (POSILLIPO_COORDS) per la comparazione geoUtils
    const isPosillipo = geoUtils.areCoordsNear(normalizedLocation, POSILLIPO_COORDS); 
    const cacheKey = `forecast-data-v-refactored-${normalizedLocation}`;

    if (cacheLocks.has(cacheKey)) {
        log(`LOCK HIT: Chiave ${cacheKey} in fase di aggiornamento. Attendo...`, 'Master Fetch Log');
        return cacheLocks.get(cacheKey);
    }
    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            log(`Cache HIT for ${resolvedName} (${normalizedLocation})`, 'Master Fetch Log');
            return cachedData;
        }
        log(`Cache MISS for ${resolvedName} (${normalizedLocation}). Acquisizione LOCK e Fetching new data...`, 'Master Fetch Log');

        let resolveLock, rejectLock;
        const updatePromise = new Promise((resolve, reject) => { resolveLock = resolve; rejectLock = reject; });
        cacheLocks.set(cacheKey, updatePromise);

        console.time("PERF: Promise.all(API_Calls)");
        const promises = [ fetchWwoDaily(lat, lon), fetchOpenMeteoHourly(lat, lon), ];

        if (isPosillipo) {
            log(`Location è Posillipo. Aggiungo fetch premium (Stormglass)...`, 'Master Fetch Log');
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch Log] Stormglass fetch failed:', err.message);
                return null;
            }));
        } else {
            log(`Location NON è Posillipo (Stormglass NON richiesto).`, 'Master Fetch Log');
            promises.push(Promise.resolve(null));
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);
        console.timeEnd("PERF: Promise.all(API_Calls)");

        console.log(`\n******************************************************`);
        console.log(`************ [DEBUG Summary] API Status ************`);
        const wwoStatus = (wwoDailyData && wwoDailyData.length > 0) ? 'OK' : 'ERROR';
        const omStatus = (openMeteoHourlyData && Object.keys(openMeteoHourlyData).length > 0) ? 'OK' : 'ERROR';
        let stormglassStatus = 'Non Richiesto';
        if (isPosillipo) {
            stormglassStatus = stormglassData ? 'OK' : 'ERROR (Fallito)';
        }
        console.log(`*  1. WWO (Base/Maree):      ${wwoStatus}`);
        console.log(`*  2. OpenMeteo (Orari):     ${omStatus}`);
        console.log(`*  3. Stormglass (Correnti): ${stormglassStatus}`);
        console.log(`******************************************************\n`);

        let previousDayData = null;
        const finalForecast = [];
        let hasLoggedScoreParams = false;
        let dayIndex = 0;

        const getStormglassCurrent = (date, hour) => {
            const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
            if (!stormglassData || !stormglassData[date]) return defaultData;
            const hourStr = String(hour).padStart(2, '0');
            const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
            return sgHourData ? { currentSpeedKn: sgHourData.currentSpeedKn, currentDirectionStr: sgHourData.currentDirectionStr } : defaultData;
        };

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
                const isFirstDay = date === wwoDailyData[0].date;
                const isFirstHour = currentHour === parseInt(omHourly[0].time.split(':')[0], 10);
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
            const allHourlyWmoCodes = omHourly.map(h => h.weatherCode);
            const mostSignificantWmoCode = getMostSignificantWeatherCode(allHourlyWmoCodes);
            const dailyWeatherCode = converter.convertWmoToWwoCode(mostSignificantWmoCode);
            const representativeWindData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
            const dailyWindDirectionDegrees = representativeWindData.windDirection;
            
            const sunriseHour = formatter.timeToHours(wwoDay.astronomy[0].sunrise);
            const sunsetHour = formatter.timeToHours(wwoDay.astronomy[0].sunset);
            const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
            const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
            const allTides = [...highTides.map(t => ({...t, type: 'Alta', tideTime: t.tideTime})), ...lowTides.map(t => ({...t, type: 'Bassa', tideTime: t.tideTime}))];

            const findClosestTide = (hour, tides) => {
                if (!tides || tides.length === 0) return { type: 'N/A', tideTime: '' };
                return tides.reduce((prev, curr) => {
                    const prevDiff = Math.abs(formatter.timeToHours(prev.tideTime) - hour);
                    const currDiff = Math.abs(formatter.timeToHours(curr.tideTime) - hour);
                    return currDiff < prevDiff ? curr : prev;
                });
            };

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
            
            const isToday = (dayIndex === 0);
            const liveHourData = isToday 
                ? (enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0])
                : (enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12]);

            const temperaturaAcqua = String(Math.round(omHourly.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / omHourly.length));
            const { currentSpeedKn, currentDirectionStr } = liveHourData || {};
            const currentDataString = (currentSpeedKn && currentDirectionStr && currentSpeedKn !== 'N/D') 
                ? `${parseFloat(currentSpeedKn).toFixed(1)} kn ${currentDirectionStr}` 
                : 'N/D';

            finalForecast.push({
                giornoNome: formatter.capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: formatter.getMeteoIconFromCode(liveHourData.weatherCode),
                weatherDesc: converter.getWeatherDescription(dailyWeatherCode),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
                pressione: String(Math.round(dailyAvgPressure)),
                umidita: String(dailyAvgHumidity),
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${converter.degreesTo16PointDirection(representativeWindData.windDirection)}`,
                mare: `${formatter.getSeaStateAcronym(liveHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,
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
                dailyPressure, dailyWindSpeedKn: dailyAvgWindSpeedKph / 1.852, dailyWindDirectionDegrees, 
                sunriseTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
                sunsetTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunset),
                moonPhase: moonPhaseString,
                hourly: hourlyClientFormat
            });
            previousDayData = { dailyPressure };
            dayIndex++;
        }

        const apiResponse = {
            fonti: "Open-Meteo & WorldWeatherOnline" + (stormglassData ? " & Stormglass (Corrente)" : ""),
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        myCache.set(cacheKey, apiResponse);
        log(`Cache aggiornata e LOCK rilasciato per: ${cacheKey}`, 'Master Fetch Log');
        
        // --- TRIGGER ANALISI PROATTIVA IN BACKGROUND ---
        (async () => {
            try {
                await runProactiveAnalysis(apiResponse, normalizedLocation);
            } catch (e) {
                console.error("[PROACTIVE-TRIGGER-ERROR] L'analisi proattiva in background è fallita:", e.message);
            }
        })();
        // ----------------------------------------------

        resolveLock(apiResponse);
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

// ESPORTAZIONE IN FORMATO ES MODULE
export {
    getUnifiedForecastData,
    getUnifiedForecastData as fetchAndProcessForecast, // Esporta un alias per retrocompatibilità
};
