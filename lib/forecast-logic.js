// /lib/forecast-logic.js
const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');


const myCache = new NodeCache({ stdTTL: 21600 });
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

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

// --- SEZIONE CALCOLO SCORE E FINESTRE ---
function calculateHourlyPescaScore(params) {
    let score = 3.0;
    const reasons = [];
    const { pressure, trendPressione, windSpeedKph, isNewOrFullMoon, cloudCover, waveHeight, waterTemp } = params;
    
    // Ritorna oggetti { icon, text, ... } come richiesto dal frontend
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

    if (waveHeight !== null) {
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    }

    if (waterTemp !== null) {
        if (waterTemp >= 12 && waterTemp <= 20) { score += 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); }
        else if (waterTemp < 10 || waterTemp > 24) { score -= 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); }
    }
    
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

// --- SEZIONE FETCHING DATI DALLE API ---
async function fetchOpenMeteoHourly(lat, lon) {
    const forecastParams = ['temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','windspeed_10m','winddirection_10m','weathercode'].join(',');
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
            waveHeight: marineApiData.wave_height[i],
            waterTemperature: marineApiData.sea_surface_temperature[i],
            currentVelocity: null,
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

// --- FUNZIONE PRINCIPALE ---
async function fetchAndProcessForecast(location) {
    const cacheKey = `forecast-data-v-FINALISSIMA-2-${location}`;
    
    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache] HIT for ${location}`);
            return cachedData;
        }

        console.log(`[Cache] MISS for ${location}. Fetching new data...`);
        const [lat, lon] = location.split(',');
        const [wwoDailyData, openMeteoHourlyData] = await Promise.all([
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
        ]);
        
        let previousDayData = null;
        const finalForecast = [];

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
                const hour = parseInt(h.time.split(':')[0], 10);
                const scoreData = calculateHourlyPescaScore({
                    pressure: h.pressure, trendPressione, windSpeedKph: h.windSpeed,
                    isNewOrFullMoon, cloudCover: h.cloudCover,
                    waveHeight: h.waveHeight, waterTemp: h.waterTemperature,
                });
                return { hour, score: scoreData.numericScore, reasons: scoreData.reasons };
            });

            const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
            const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));

            // Calcoliamo i valori medi per l'intera giornata
            const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
            const dailyAvgWindSpeedKph = Math.round(omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length);
            
            // Per la direzione del vento e l'icona meteo, usiamo l'ora più rappresentativa (14:00)
            const representativeDailyData = omHourly.find(h => h.time.startsWith('14:')) ?? omHourly[12];
            const dailyWindDirection = degreesTo16PointDirection(representativeDailyData.windDirection);
            const dailyWeatherCode = convertWmoToWwoCode(representativeDailyData.weatherCode);             

            // Definiamo la variabile 'representativeReasons' qui.
            // La prendiamo dai dati orari dell'ora rappresentativa (le 12:00)
            const representativeHourData = hourlyScoresData.find(h => h.hour === 12) ?? hourlyScoresData[0];
            const representativeReasons = representativeHourData.reasons;

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

            const hourlyClientFormat = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                return {
                    time: h.time,
                    tempC: String(Math.round(h.temperature)),
                    weatherCode: convertWmoToWwoCode(h.weatherCode),
                    winddir16Point: degreesTo16PointDirection(h.windDirection),
                    // NUOVA CHIAVE: determina se è giorno o notte
                    isDay: currentHour >= sunriseHour && currentHour < sunsetHour
                };
            });

            const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
            const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
            const currentHourData = omHourly.find(h => parseInt(h.time.split(':')[0]) >= new Date().getHours()) ?? omHourly[0];

            finalForecast.push({
                giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                // ==> DATI ASTRONOMICI PULITI E STANDARDIZZATI
                sunriseTime: formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
                sunsetTime: formatTimeToHHMM(wwoDay.astronomy[0].sunset),
                moonPhase: wwoDay.astronomy[0].moon_phase,
                _debug_astro: console.log(`[Backend Astro Log] Data: ${date}, Alba: ${formatTimeToHHMM(wwoDay.astronomy[0].sunrise)}, Tramonto: ${formatTimeToHHMM(wwoDay.astronomy[0].sunset)}, Luna: ${wwoDay.astronomy[0].moon_phase}`),
                // <== FINE DATI ASTRONOMICI
                dailyWeatherCode: dailyWeatherCode, // Icona meteo rappresentativa del giorno
                dailyWind: `${dailyAvgWindSpeedKph} km/h ${dailyWindDirection}`, // Es: "15 km/h NNE"
                dailyHumidity: `${dailyAvgHumidity}%`, // Es: "75%"                
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
                temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
                temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
                temperaturaAvg: String(Math.round(omHourly.map(h=>h.temperature).reduce((a,b)=>a+b,0) / omHourly.length)),
                pressione: String(Math.round(dailyPressure)),
                umidita: String(Math.round(omHourly.map(h=>h.humidity).reduce((a,b)=>a+b,0) / omHourly.length)),
                trendPressione,
                ventoDati: `${(Math.max(...omHourly.map(h=>h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(currentHourData.windDirection)}`,
                pescaScoreData: {
                    numericScore: avgNumericScore,
                    displayScore: displayScore,
                    hourlyScores: hourlyScoresData.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score })),
                    // La variabile ora è definita e può essere usata senza errori
                    reasons: representativeReasons, 
                },
                pescaScore: displayScore,
                finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
                finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
                acronimoMare: getSeaStateAcronym(currentHourData.waveHeight),
                temperaturaAcqua: String(Math.round(omHourly.map(h=>h.waterTemperature).reduce((a,b)=>a+b,0) / omHourly.length)),
                velocitaCorrente: 'N/D',
                hourly: hourlyClientFormat,
            });

            previousDayData = { dailyPressure };
        }

        const apiResponse = {
            fonti: "Open-Meteo & WorldWeatherOnline",
            forecast: finalForecast,
            dateRange: `${format(parseISO(wwoDailyData[0].date), 'dd/MM')} - ${format(parseISO(wwoDailyData[wwoDailyData.length - 1].date), 'dd/MM')}`
        };

        myCache.set(cacheKey, apiResponse);
        return apiResponse;
    } catch (error) {
        console.error(`[FATAL ERROR in fetchAndProcessForecast for ${location}]:`, error.message, error.stack);
        return {
            fonti: "Error",
            forecast: [],
            dateRange: "N/A"
        };
    }
}

module.exports = { fetchAndProcessForecast, myCache };