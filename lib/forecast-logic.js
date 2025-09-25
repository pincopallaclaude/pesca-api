// /lib/forecast-logic.js
const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');

const myCache = new NodeCache({ stdTTL: 21600 }); // TTL di 6 ore
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

// --- SEZIONE UTILITIES ---
const capitalize = (s) => (s && s.charAt(0).toUpperCase() + s.slice(1)) || "";

const degreesTo16PointDirection = (deg) => {
    if (deg === null || deg === undefined) return '';
    const directions = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
    return directions[Math.round(deg / 22.5) % 16];
}

const convertWmoToWwoCode = (wmoCode) => {
    const code = Number(wmoCode);
    if (code === 0) return '113'; // Sereno
    if (code >= 1 && code <= 3) return '116'; // Parz. Nuvoloso
    if (code >= 45 && code <= 48) return '260'; // Nebbia
    if (code >= 51 && code <= 65) return '296'; // Pioggia
    if (code >= 66 && code <= 67) return '314'; // Pioggia gelata
    if (code >= 71 && code <= 77) return '329'; // Neve
    if (code >= 80 && code <= 82) return '353'; // Rovesci
    if (code >= 95 && code <= 99) return '389'; // Temporali
    return '119'; // Default: Nuvoloso
};

const formatTimeToHHMM = (timeStr) => {
    if (!timeStr) return 'N/D';
    if (timeStr.includes(':')) return timeStr; // Già formattato
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        let [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        if (modifier === 'PM' && hours !== '12') hours = parseInt(hours, 10) + 12;
        if (modifier === 'AM' && hours === '12') hours = '00';
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
    const time = String(timeStr).padStart(4, '0');
    return `${time.slice(0, 2)}:${time.slice(2)}`;
};

const getSeaStateAcronym = (height) => {
    if (height === null || isNaN(height)) return '-';
    if (height < 0.1) return 'C'; if (height < 0.5) return 'QC';
    if (height < 1.25) return 'PM'; if (height < 2.5) return 'M';
    if (height < 4) return 'MM'; if (height < 6) return 'A';
    return 'G';
}

// --- SEZIONE CALCOLO SCORE E FINESTRE ---
function calculateHourlyPescaScore(params) {
    let score = 3.0;
    const { pressure, trendPressione, windSpeedKph, isNewOrFullMoon, cloudCover, waveHeight, waterTemp } = params;
    
    if (trendPressione === '↓') score += 1.5;
    else if (trendPressione === '↑') score -= 1.0;
    
    if (windSpeedKph > 5 && windSpeedKph < 20) score += 1.0;
    else if (windSpeedKph > 30) score -= 2.0;

    if (isNewOrFullMoon) score += 1.0;

    if (cloudCover > 60) score += 1.0;
    else if (cloudCover < 20 && pressure > 1018) score -= 1.0;

    if (waveHeight !== null) {
        if (waveHeight >= 0.5 && waveHeight <= 1.25) score += 2.0;
        else if (waveHeight > 1.25 && waveHeight <= 2.5) score += 1.0;
        else if (waveHeight < 0.5) score -= 1.0;
        else if (waveHeight > 2.5) score -= 2.0;
    }
    
    if (waterTemp !== null) {
        if (waterTemp >= 12 && waterTemp <= 20) score += 1.0;
        else if (waterTemp < 10 || waterTemp > 24) score -= 1.0;
    }
    
    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score)))
    };
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1; let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    for (let i = 0; i < relevantHours.length - 1; i++) {
        if(relevantHours[i+1].hour !== relevantHours[i].hour + 1) continue; // Salta se le ore non sono consecutive
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
    const hourlyParams = ['temperature_2m','relative_humidity_2m','pressure_msl','cloud_cover','windspeed_10m','winddirection_10m','weathercode','wave_height','sea_surface_temperature'].join(',');
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&forecast_days=7`;
    const response = await axios.get(url);
    const apiData = response.data.hourly;
    const dataByDay = {};
    for (let i = 0; i < apiData.time.length; i++) {
        const date = apiData.time[i].split('T')[0];
        if (!dataByDay[date]) dataByDay[date] = [];
        dataByDay[date].push({
            time: apiData.time[i].split('T')[1],
            temperature: apiData.temperature_2m[i],
            humidity: apiData.relative_humidity_2m[i],
            pressure: apiData.pressure_msl[i],
            cloudCover: apiData.cloud_cover[i],
            windSpeed: apiData.windspeed_10m[i],
            windDirection: apiData.winddirection_10m[i],
            weatherCode: apiData.weathercode[i],
            waveHeight: apiData.wave_height[i],
            waterTemperature: apiData.sea_surface_temperature[i],
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
    const cacheKey = `forecast-data-final-v2-${location}`; // Nuova versione per invalidare
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

        const hourlyScores = omHourly.map(h => {
            const hour = parseInt(h.time.split(':')[0], 10);
            const scoreData = calculateHourlyPescaScore({
                pressure: h.pressure,
                trendPressione,
                windSpeedKph: h.windSpeed,
                isNewOrFullMoon: wwoDay.astronomy[0].moon_phase.toLowerCase().includes('new moon') || wwoDay.astronomy[0].moon_phase.toLowerCase().includes('full moon'),
                cloudCover: h.cloudCover,
                waveHeight: h.waveHeight,
                waterTemp: h.waterTemperature,
            });
            return {
                hour,
                score: scoreData.numericScore, // Assicuriamoci che 'score' sia il nome corretto
            };
        });
        
        const avgNumericScore = hourlyScores.reduce((sum, h) => sum + h.score, 0) / hourlyScores.length;

        const hourlyClientFormat = omHourly.map(h => ({
            time: h.time,
            tempC: String(Math.round(h.temperature)),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            winddir16Point: degreesTo16PointDirection(h.windDirection),
        }));

        const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        
        finalForecast.push({
            giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
            giornoData: format(parseISO(date), 'dd/MM'),
            meteoIcon: getMeteoIconFromCode(omHourly.find(h => parseInt(h.time.split(':')[0]) >= new Date().getHours())?.weatherCode ?? omHourly[0].weatherCode),
            moon_phase: wwoDay.astronomy[0].moon_phase,
            alba: `☀️ ${formatTimeToHHMM(wwoDay.astronomy[0].sunrise)}`,
            tramonto: formatTimeToHHMM(wwoDay.astronomy[0].sunset),
            maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
            temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
            temperaturaAvg: String(Math.round(omHourly.map(h=>h.temperature).reduce((a,b)=>a+b,0) / omHourly.length)),
            pressione: String(Math.round(dailyPressure)),
            umidita: String(Math.round(omHourly.map(h=>h.humidity).reduce((a,b)=>a+b,0) / omHourly.length)),
            trendPressione,
            ventoDati: `${(Math.max(...omHourly.map(h=>h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(omHourly[new Date().getHours()]?.windDirection)}`,
            pescaScoreData: {
                numericScore: avgNumericScore,
                displayScore: Math.min(5, Math.max(1, Math.round(avgNumericScore))),
                hourlyScores: hourlyScores.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score })),
            },
            finestraMattino: { orario: findBestTimeWindow(hourlyScores, 4, 13) ?? "N/D" },
            finestraSera: { orario: findBestTimeWindow(hourlyScores, 14, 22) ?? "N/D" },
            acronimoMare: getSeaStateAcronym(omHourly[new Date().getHours()]?.waveHeight),
            temperaturaAcqua: String(Math.round(omHourly.map(h=>h.waterTemperature).reduce((a,b)=>a+b,0) / omHourly.length)),
            velocitaCorrente: String((omHourly.map(h=>h.currentVelocity).filter(v=>v!==null).reduce((a,b)=>a+b,0) / (omHourly.filter(h=>h.currentVelocity!==null).length || 1) * 1.94384).toFixed(1)),
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
}

module.exports = { fetchAndProcessForecast, myCache };