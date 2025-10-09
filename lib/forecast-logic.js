// /lib/forecast-logic.js

const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');
const { fetchStormglassData } = require('./services/stormglass.service');

const myCache = new NodeCache({ stdTTL: 21600 });
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';
const cacheLocks = new Map();

/**
 * Calculate distance between two coordinates (Haversine formula) and check if they are near.
 * @param {string} coords1 - "lat,lon" of first coordinate.
 * @param {string} coords2 - "lat,lon" of second coordinate.
 * @param {number} toleranceKm - Tolerance in kilometers.
 * @returns {boolean}
 */
function areCoordsNear(coords1, coords2, toleranceKm = 1) {
    const [lat1_str, lon1_str] = coords1.split(',');
    const [lat2_str, lon2_str] = coords2.split(',');

    const lat1 = parseFloat(lat1_str);
    const lon1 = parseFloat(lon1_str);
    const lat2 = parseFloat(lat2_str);
    const lon2 = parseFloat(lon2_str);

    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat)/2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon))/2;
    
    const distance = R * 2 * Math.asin(Math.sqrt(a));
    return distance < toleranceKm;
}

// --- UTILITIES SECTION ---
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

    // If contains AM/PM, convert it
    if (String(timeStr).includes('AM') || String(timeStr).includes('PM')) {
        let [time, modifier] = String(timeStr).split(' ');
        let [hours, minutes] = time.split(':');
        
        hours = parseInt(hours, 10);
        
        if (modifier === 'AM' && hours === 12) { // Midnight
            hours = 0;
        }
        if (modifier === 'PM' && hours !== 12) { // Afternoon
            hours += 12;
        }
        
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
    
    // If already in time format (e.g., "18:58") return it
    if (String(timeStr).includes(':')) return timeStr;

    // Handle numeric formats (e.g., "600" -> "06:00")
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

// --- SCORE CALCULATION AND WINDOWS SECTION ---

/**
 * Calculate hourly fishing score based on various parameters.
 * @param {object} params - Hourly parameters.
 * @returns {{numericScore: number, reasons: Array<object>}} - Score and reasons.
 */
function calculateHourlyPescaScore(params) {
    let score = 3.0;
    const reasons = [];
    
    const { 
        pressure, trendPressione, windSpeedKph, isNewOrFullMoon, 
        cloudCover, waveHeight, waterTemp, currentSpeedKn,
        currentDirectionStr
    } = params;
    
    // Detailed log of input values for score calculation
    console.log(`[Score Calc DEBUG] Hour: ${params.hour}, Wind: ${windSpeedKph.toFixed(1)} km/h, Waves: ${waveHeight?.toFixed(2)} m, Current: ${currentSpeedKn} kn, Current Dir: ${currentDirectionStr}`);

    // Pressure
    if (trendPressione === '↓') { score += 1.5; reasons.push({ icon: 'pressure_down', text: "Pressure falling", points: "+1.5", type: "positive" }); }
    else if (trendPressione === '↑') { score -= 1.0; reasons.push({ icon: 'pressure_up', text: "Pressure rising", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'pressure', text: "Pressure stable", points: "+0.0", type: "neutral" }); }

    // Wind
    if (windSpeedKph > 5 && windSpeedKph < 20) { score += 1.0; reasons.push({ icon: 'wind', text: "Ideal wind (5-20 km/h)", points: "+1.0", type: "positive" }); }
    else if (windSpeedKph > 30) { score -= 2.0; reasons.push({ icon: 'wind', text: "Strong wind (>30 km/h)", points: "-2.0", type: "negative" }); }
    else { reasons.push({ icon: 'wind', text: "Light/variable wind", points: "+0.0", type: "neutral" }); }

    // Moon
    if (isNewOrFullMoon) { score += 1.0; reasons.push({ icon: 'moon', text: "New or Full Moon", points: "+1.0", type: "positive" }); }
    else { reasons.push({ icon: 'moon', text: "Neutral moon phase", points: "+0.0", type: "neutral" }); }

    // Cloud cover
    if (cloudCover > 60) { score += 1.0; reasons.push({ icon: 'clouds', text: "Overcast >60%", points: "+1.0", type: "positive" }); }
    else if (cloudCover < 20 && pressure > 1018) { score -= 1.0; reasons.push({ icon: 'clouds', text: "Clear sky with high pressure", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'clouds', text: "Neutral cloud cover", points: "+0.0", type: "neutral" }); }

    // Waves (Wave Height)
    if (waveHeight !== null && waveHeight !== undefined) {
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Slightly rough sea (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Rough sea (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Calm sea (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Agitated sea (>2.5m)", points: "-2.0", type: "negative" }); }
    } else {
        reasons.push({ icon: 'waves', text: "Wave data not available", points: "+0.0", type: "neutral" });
    }

    // Water temperature
    if (waterTemp !== null && waterTemp !== undefined) {
        if (waterTemp >= 12 && waterTemp <= 20) { 
            score += 1.0; reasons.push({ icon: 'water_temp', text: "Ideal water temp (12-20°C)", points: "+1.0", type: "positive" }); 
        } else if (waterTemp < 10 || waterTemp > 24) { 
            score -= 1.0; reasons.push({ icon: 'water_temp', text: "Extreme water temp", points: "-1.0", type: "negative" }); 
        } else {
            reasons.push({ icon: 'water_temp', text: "Neutral water temp", points: "+0.0", type: "neutral" }); 
        }
    } else {
        reasons.push({ icon: 'water_temp', text: "Water temp N/A", points: "+0.0", type: "neutral" });
    }
    
    // Current speed logic
    let currentPoints = 0.0;
    let currentText = "Current data not available";
    let currentType = "neutral";
    let currentIcon = "swap_horiz";

    if (currentSpeedKn !== 'N/D') {
        const speed = parseFloat(currentSpeedKn);
        
        if (speed > 0.3 && speed <= 0.8) {
            currentPoints = 1.0; currentText = "Ideal current (0.3-0.8 kn)"; currentType = "positive";
        } else if (speed > 0.8) {
            currentPoints = -1.0; currentText = "Strong current (>0.8 kn)"; currentType = "negative";
        } else {
            currentText = "Weak/no current"; 
        }
    } 
    
    score += currentPoints;
    reasons.push({ 
        icon: currentIcon, 
        text: currentText, 
        points: currentPoints >= 0 ? `+${currentPoints.toFixed(1)}` : currentPoints.toFixed(1), 
        type: currentType 
    });

    console.log(`[Score Calc DEBUG] Current Score: ${currentPoints.toFixed(1)}, Total Score: ${score.toFixed(1)}`);

    return {
        numericScore: score,
        reasons: reasons
    };
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
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
    
    const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
    return `${formatHour(bestWindowStart)} - ${formatHour(bestWindowStart + 2)}`; 
}

// --- API DATA FETCHING SECTION ---
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
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`;
    const response = await axios.get(url);
    if (!response.data?.data?.weather) throw new Error("WWO API response structure is invalid.");
    return response.data.data.weather;
}

// --- NEW MASTER FUNCTION - REPLACES EVERYTHING ---
// This function is the ONLY way to get data, handles cache, lock and everything.
async function getUnifiedForecastData(location) {
    console.log(`\n\n--- [MASTER FETCH] Starting request for location: "${location}" ---`);

    const [lat_str, lon_str] = location.split(',');
    const lat = parseFloat(lat_str).toFixed(3);
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    console.log(`[Master Fetch] Normalized location: "${normalizedLocation}"`);
    const isPosillipo = areCoordsNear(location, POSILLIPO_COORDS);
    const cacheKey = `forecast-data-v-ULTIMA-PROVA-1-${normalizedLocation}`;

    // --- CACHE AND LOCK LOGIC ---
    if (cacheLocks.has(cacheKey)) {
        console.log(`[Master Fetch] LOCK HIT: Key ${cacheKey} being updated. Waiting...`);
        return cacheLocks.get(cacheKey);
    }

    const cachedData = myCache.get(cacheKey);
    if (cachedData) {
        console.log(`[Master Fetch] Cache HIT for ${location}`);
        return cachedData.forecast;
    }

    console.log(`[Master Fetch] Cache MISS for ${location}. Acquiring LOCK and fetching new data...`);
    
    let resolveLock;
    let rejectLock;
    const updatePromise = new Promise((resolve, reject) => {
        resolveLock = resolve;
        rejectLock = reject;
    });
    cacheLocks.set(cacheKey, updatePromise);

    try {
        // --- START REAL FETCH ---
        const promises = [
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
        ];

        if (isPosillipo) {
            console.log(`[Master Fetch] Location is Posillipo. Adding premium fetch (Stormglass)...`);
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Master Fetch] Stormglass fetch failed, proceeding without current data:', err.message);
                return null;
            }));
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);

        let previousDayData = null;
        const finalForecast = [];
        
        const getStormglassCurrent = (date, hour) => {
            const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
            if (!isPosillipo || !stormglassData || !stormglassData[date]) return defaultData;
            const hourStr = String(hour).padStart(2, '0');
            const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
            return sgHourData ? { 
                currentSpeedKn: sgHourData.currentSpeedKn, 
                currentDirectionStr: sgHourData.currentDirectionStr 
            } : defaultData;
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

            const isNewOrFullMoon = wwoDay.astronomy[0].moon_phase.toLowerCase().includes('new moon') || wwoDay.astronomy[0].moon_phase.toLowerCase().includes('full moon');
            
            const hourlyScoresData = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                
                const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);

                console.log(`[Data Merge DEBUG] Day ${date} @ ${h.time}: Stormglass current -> ${currentSpeedKn} kn ${currentDirectionStr}`);
                
                const scoreData = calculateHourlyPescaScore({
                    hour: currentHour,
                    pressure: h.pressure,
                    trendPressione,
                    windSpeedKph: h.windSpeed,
                    isNewOrFullMoon,
                    cloudCover: h.cloudCover,
                    waveHeight: h.waveHeight,
                    waterTemp: h.waterTemperature,
                    currentSpeedKn: currentSpeedKn,
                    currentDirectionStr: currentDirectionStr
                });

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
            const allTides = [...highTides.map(t => ({...t, type: 'Alta'})), ...lowTides.map(t => ({...t, type: 'Bassa'}))];
            
            const findClosestTide = (hour, tides) => {
                if (!tides || tides.length === 0) return { type: 'N/A', tideTime: ''};
                return tides.reduce((prev, curr) => {
                    const prevDiff = Math.abs(timeToHours(prev.tideTime) - hour);
                    const currDiff = Math.abs(timeToHours(curr.tideTime) - hour);
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
                ? `${currentSpeedKn} kn ${currentDirectionStr}`
                : `N/D`;

            finalForecast.push({
                giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
                pressione: String(Math.round(dailyAvgPressure)),
                umidita: String(dailyAvgHumidity),
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(currentHourData.windDirection)}`,
                mare: `${getSeaStateAcronym(currentHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,
                maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
                finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
                finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
                pescaScoreData: {
                    numericScore: avgNumericScore,
                    displayScore: displayScore,
                    hourlyScores: hourlyScoresData.map(h => ({ 
                        time: `${String(h.hour).padStart(2, '0')}:00`, 
                        score: h.score,
                        reasons: h.reasons 
                    })),
                },
                temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
                temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
                trendPressione: trendPressione,
                dailyWeatherCode: dailyWeatherCode,
                dailyHumidity: dailyAvgHumidity,
                dailyPressure: dailyAvgPressure,
                dailyWindSpeedKn: dailyWindSpeedKn,
                dailyWindDirectionDegrees: dailyWindDirectionDegrees,
                sunriseTime: formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
                sunsetTime: formatTimeToHHMM(wwoDay.astronomy[0].sunset),
                moonPhase: wwoDay.astronomy[0].moon_phase,
                hourly: hourlyClientFormat
            });

            previousDayData = { dailyPressure };
        }

        const apiResponse = {
            fonti: "Open-Meteo & WorldWeatherOnline" + (isPosillipo ? " & Stormglass (Current)" : ""),
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        myCache.set(cacheKey, apiResponse);
        console.log(`[Master Fetch] Cache updated and LOCK released for: ${cacheKey}`);
        resolveLock(apiResponse.forecast);
        return apiResponse.forecast;

    } catch (error) {
        console.error(`[Master Fetch] ERROR during forecast update for ${cacheKey}: ${error.message}`, error.stack);
        
        const cachedData = myCache.get(cacheKey);
        
        if (cacheLocks.has(cacheKey)) {
             cacheLocks.get(cacheKey).catch(() => {});
             cacheLocks.delete(cacheKey);
             if(typeof rejectLock === 'function') rejectLock(error);
        }
        
        if (cachedData) {
            console.warn(`[Master Fetch] Fallback to cached data after error for: ${cacheKey}`);
            return cachedData.forecast;
        }

        throw error;
    } finally {
        if (cacheLocks.has(cacheKey)) {
            cacheLocks.delete(cacheKey);
        }
    }
}

// Rename old function and point it to new one for backward compatibility
const fetchAndProcessForecast = getUnifiedForecastData;

module.exports = { getUnifiedForecastData, fetchAndProcessForecast, myCache };