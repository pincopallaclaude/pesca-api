// /lib/forecast-logic.js

const axios = require('axios');
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');
const NodeCache = require('node-cache');


const myCache = new NodeCache({ stdTTL: 21600 });
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

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

// --- SEZIONE CALCOLO SCORE E FINESTRE ---
function calculateHourlyPescaScore(params) {
    let score = 3.0;
    const reasons = [];
    const { pressure, trendPressione, windSpeedKph, isNewOrFullMoon, cloudCover, waveHeight, waterTemp } = params;
    
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
    if (waveHeight !== null) {
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    }

    // Temperatura dell'acqua (MODIFICATA)
    if (waterTemp !== null) {
        if (waterTemp >= 12 && waterTemp <= 20) { 
            score += 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); 
        } else if (waterTemp < 10 || waterTemp > 24) { 
            score -= 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); 
        } else {
            // CHIAVE: Aggiunto il caso 'neutro' che mancava (tra 10-12 e 20-24)
            reasons.push({ icon: 'water_temp', text: "Temp. acqua neutra", points: "+0.0", type: "neutral" }); 
        }
    } else {
        // Fallback se il dato non è proprio disponibile
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
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

async function fetchStormglassData(lat, lon) {
    const params = 'currentSpeed'; // Chiediamo solo la velocità della corrente
    const url = `https://api.stormglass.io/v2/weather/point?lat=${lat}&lng=${lon}&params=${params}`;
    const response = await axios.get(url, {
        headers: { 'Authorization': process.env.STORMGLASS_API_KEY }
    });

    const dataByDay = {};
    for (const hourData of response.data.hours) {
        const date = hourData.time.split('T')[0];
        if (!dataByDay[date]) {
            dataByDay[date] = [];
        }
        dataByDay[date].push({
            hour: hourData.time.split('T')[1].split(':')[0],
            currentSpeed: hourData.currentSpeed.sg, // Usiamo il valore sg (Storm Glass)
        });
    }
    return dataByDay;
}

// --- FUNZIONE PRINCIPALE ---
async function fetchAndProcessForecast(location) {
    // ==========================================================
    // ========= NUOVA SEZIONE DI DEBUG PER LA CACHE ============
    // ==========================================================
    console.log(`\n\n--- [CACHE DEBUG] Inizio richiesta per location: "${location}" ---`);

    // Arrotondiamo le coordinate per creare una "griglia" e neutralizzare micro-variazioni
    const [lat_str, lon_str] = location.split(',');
    const lat = parseFloat(lat_str).toFixed(3); // 3 cifre decimali ~ 111 metri di precisione
    const lon = parseFloat(lon_str).toFixed(3);
    const normalizedLocation = `${lat},${lon}`;
    
    console.log(`[CACHE DEBUG] Location normalizzata a 3 decimali: "${normalizedLocation}"`);
    // ==========================================================

    const isPosillipo = areCoordsNear(location, POSILLIPO_COORDS);
    
    // CHIAVE: Usiamo la location normalizzata per la chiave della cache
    const cacheKey = `forecast-data-v-FINALISSIMA-3-${normalizedLocation}`;
    console.log(`[CACHE DEBUG] Chiave della cache generata: "${cacheKey}"`);
    
    try {
        const cachedData = myCache.get(cacheKey);
        if (cachedData) {
            console.log(`[Cache] HIT for ${location}`);
            return cachedData;
        }

        console.log(`[Cache] MISS for ${location}. Fetching new data...`);
        // Usiamo le coordinate originali per il fetch API (hanno bisogno della massima precisione)
        // const [lat, lon] = location.split(','); <--- rimosso perché 'lat' e 'lon' sono definiti sopra
        
        // Prepariamo le chiamate in parallelo
        const promises = [
            fetchWwoDaily(lat, lon),
            fetchOpenMeteoHourly(lat, lon),
        ];

        // Se è Posillipo, aggiungiamo la chiamata a Stormglass
        if (isPosillipo) {
            console.log(`[Core] Location is Posillipo. Adding premium fetch (Stormglass)...`);
            promises.push(fetchStormglassData(lat, lon).catch(err => {
                console.warn('[Core] Stormglass fetch failed, proceeding without current data:', err.message);
                return null; // Fallback: in caso di errore, restituisce null invece di far fallire tutto
            }));
        }

        const [wwoDailyData, openMeteoHourlyData, stormglassData] = await Promise.all(promises);
        
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
            
            // --- INIZIO: PRIMA MODIFICA (Arricchire hourlyScoresData) ---
            const hourlyScoresData = omHourly.map(h => {
                const hour = parseInt(h.time.split(':')[0], 10);
                const scoreData = calculateHourlyPescaScore({
                    pressure: h.pressure, trendPressione, windSpeedKph: h.windSpeed,
                    isNewOrFullMoon, cloudCover: h.cloudCover,
                    waveHeight: h.waveHeight, waterTemp: h.waterTemperature,
                });
                // CHIAVE: Includiamo sia lo score che i 'reasons' di QUELLA specifica ora
                return { 
                    hour, 
                    score: scoreData.numericScore, 
                    reasons: scoreData.reasons 
                };
            });
            // --- FINE: PRIMA MODIFICA ---

            const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
            const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));

            // Calcoliamo i valori medi per l'intera giornata
            const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
            const dailyAvgWindSpeedKph = omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length;
            const dailyAvgPressure = Math.round(omHourly.map(h => h.pressure).reduce((a,b)=>a+b,0) / omHourly.length);

            // Per la direzione del vento e l'icona meteo, usiamo l'ora più rappresentativa (14:00)
            const representativeDailyData = omHourly.find(h => h.time.startsWith('14:')) ?? omHourly[12];
            const dailyWeatherCode = convertWmoToWwoCode(representativeDailyData.weatherCode);

            // Dati puri per il frontend
            const dailyWindDirectionDegrees = representativeDailyData.windDirection;
            const dailyWindSpeedKn = Math.round(dailyAvgWindSpeedKph / 1.852); // Conversione da Kph a Nodi 
            
            // --- SECONDA MODIFICA (Blocco rimosso) ---
            // const representativeHourData = hourlyScoresData.find(h => h.hour === 12) ?? hourlyScoresData[0];
            // const representativeReasons = representativeHourData.reasons;
            // --- FINE: SECONDA MODIFICA ---

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
            const allTides = [...highTides.map(t => ({...t, type: 'Alta'})), ...lowTides.map(t => ({...t, type: 'Bassa'}))];
            
            const findClosestTide = (hour, tides) => {
                if (!tides || tides.length === 0) return { type: 'N/A', time: ''};
                return tides.reduce((prev, curr) => {
                    const prevDiff = Math.abs(timeToHours(prev.tideTime) - hour);
                    const currDiff = Math.abs(timeToHours(curr.tideTime) - hour);
                    return currDiff < prevDiff ? curr : prev;
                });
            };

            const hourlyClientFormat = omHourly.map(h => {
                const currentHour = parseInt(h.time.split(':')[0], 10);
                const closestTide = findClosestTide(currentHour, allTides);
                
                let currentSpeedKn = 'N/D';

                // ==========================================================
                // ========= SEZIONE DI DEBUG DETTAGLIATO PER IL BACKEND ======
                // ==========================================================
                
                const currentHourString = String(currentHour).padStart(2, '0');

                console.log(`\n--- [BACKEND DEBUG] Analisi per il giorno ${date} @ ora ${currentHourString}:00 ---`);

                console.log(`[BACKEND DEBUG] 1. 'isPosillipo' è: ${isPosillipo}`);
                console.log(`[BACKEND DEBUG] 2. 'stormglassData' è definito? ${!!stormglassData}`);
                console.log(`[BACKEND DEBUG] 3. 'stormglassData[${date}]' è definito? ${!!(stormglassData && stormglassData[date])}`);
                
                if (isPosillipo && stormglassData && stormglassData[date]) {
                    console.log(`[BACKEND DEBUG] ---> CONDIZIONE IF SUPERATA <---. Cerco l'ora nei dati di Stormglass.`);

                    const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === currentHourString);
                    
                    if (sgHourData) {
                        console.log(`[BACKEND DEBUG] 4. Corrispondenza trovata per l'ora ${currentHourString}:`, JSON.stringify(sgHourData));
                        
                        if (sgHourData.currentSpeed != null && !isNaN(sgHourData.currentSpeed)) {
                            console.log(`[BACKEND DEBUG] 5. Valore 'currentSpeed' è VALIDO: ${sgHourData.currentSpeed}. Procedo con la conversione.`);
                            
                            let speedInKn = sgHourData.currentSpeed * 1.94384;
                            if (speedInKn > 0 && speedInKn < 0.1) speedInKn = 0.1;
                            
                            currentSpeedKn = speedInKn.toFixed(1); // Assegniamo la stringa numerica
                            console.log(`[BACKEND DEBUG] ====> SUCCESSO! 'currentSpeedKn' impostato a: "${currentSpeedKn}" <====`);

                        } else {
                            console.log(`[BACKEND DEBUG] 5. ERRORE: Corrispondenza oraria trovata, ma 'currentSpeed' non è un numero valido (valore: ${sgHourData.currentSpeed}). 'currentSpeedKn' rimane "N/D".`);
                        }
                    } else {
                        console.log(`[BACKEND DEBUG] 4. ERRORE: Nessuna corrispondenza trovata per l'ora '${currentHourString}' nei dati di Stormglass. 'currentSpeedKn' rimane "N/D".`);
                    }
                } else {
                    console.log(`[BACKEND DEBUG] ---> CONDIZIONE IF FALLITA <---. 'currentSpeedKn' rimane "N/D".`);
                }

                // ==========================================================
                // ==================== FINE SEZIONE DEBUG ====================
                // ==========================================================

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
                    currentSpeedKn: currentSpeedKn, // Ora qui ci sarà o "N/D" o un numero come stringa
                    precipitationProbability: h.precipitationProbability,
                    precipitation: h.precipitation,
                    tide: `${closestTide.type} ${formatTimeToHHMM(closestTide.tideTime)}`,
                };
            });

            const currentHourData = omHourly.find(h => parseInt(h.time.split(':')[0]) >= new Date().getHours()) ?? omHourly[0];
            
            // Troviamo il valore di currentSpeedKn per la rappresentazione giornaliera (currentHourData)
            let currentSpeedKn = 'N/D';
            if (isPosillipo && stormglassData && stormglassData[date]) {
                const currentHourString = currentHourData.time.split(':')[0];
                const sgHourData = stormglassData[date].find(h => h.hour === currentHourString);
                if (sgHourData && sgHourData.currentSpeed != null && !isNaN(sgHourData.currentSpeed)) {
                    let speedInKn = sgHourData.currentSpeed * 1.94384;
                    if (speedInKn > 0 && speedInKn < 0.1) speedInKn = 0.1;
                    currentSpeedKn = speedInKn.toFixed(1);
                }
            }
            
            const temperaturaAcqua = String(Math.round(omHourly.map(h=>h.waterTemperature).reduce((a,b)=>a+b,0) / omHourly.length));

            finalForecast.push({
                // ---- SEZIONE 1: Dati usati da MainHeroModule (stringhe formattate) ----
                giornoNome: capitalize(format(parseISO(date), 'eee', { locale: it })),
                giornoData: format(parseISO(date), 'dd/MM'),
                meteoIcon: getMeteoIconFromCode(currentHourData.weatherCode),
                temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
                pressione: String(Math.round(dailyAvgPressure)),
                umidita: String(dailyAvgHumidity),
                ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${degreesTo16PointDirection(currentHourData.windDirection)}`,
                
                mare: `${getSeaStateAcronym(currentHourData.waveHeight)} ${temperaturaAcqua}° ${currentSpeedKn} kn`,

                maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
                
                finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
                finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
                
                // --- INIZIO: TERZA MODIFICA (Aggiornare la Struttura Finale del JSON) ---
                // ---- SEZIONE 2: Dati di pesca ----
                pescaScoreData: {
                    numericScore: avgNumericScore,
                    displayScore: displayScore,
                    // CHIAVE: ora 'hourlyScores' contiene tutto: time, score, e reasons
                    hourlyScores: hourlyScoresData.map(h => ({ 
                        time: `${String(h.hour).padStart(2, '0')}:00`, 
                        score: h.score,
                        reasons: h.reasons // <-- Reasons specifici per quest'ora
                    })),
                    // 'reasons' a livello giornaliero è stato rimosso
                },
                // --- FINE: TERZA MODIFICA ---

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