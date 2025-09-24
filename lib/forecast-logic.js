const axios = require('axios');
const {
    format,
    parseISO
} = require('date-fns');
const {
    it
} = require('date-fns/locale');
const NodeCache = require('node-cache');

const myCache = new NodeCache({
    stdTTL: 86400
});
const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

async function fetchStormglassData(lat, lon) {
    const params = ['waveHeight', 'waterTemperature', 'currentSpeed', 'windSpeed', 'windDirection', 'airTemperature', 'pressure', 'cloudCover', 'humidity'].join(',');
    const response = await axios.get(`https://api.stormglass.io/v2/weather/point`, {
        params: {
            lat,
            lng: lon,
            params
        },
        headers: {
            'Authorization': process.env.STORMGLASS_API_KEY
        }
    });
    return response.data;
}

function processStormglassData(stormglassData, wwoAstroTideData) {
    const dailyData = {};
    stormglassData.hours.forEach(hour => {
        const date = hour.time.split('T')[0];
        if (!dailyData[date]) {
            dailyData[date] = {
                temps: [],
                pressures: [],
                humidities: [],
                cloudCovers: [],
                windSpeeds: [],
                waveHeights: [],
                waterTemps: [],
                currentSpeeds: [],
                windDirection: 0
            };
        }
        // Accesso sicuro ai dati per evitare crash se un parametro manca
        dailyData[date].temps.push(hour.airTemperature?.sg ?? 0);
        dailyData[date].pressures.push(hour.pressure?.sg ?? 0);
        dailyData[date].humidities.push(hour.humidity?.sg ?? 0);
        dailyData[date].cloudCovers.push(hour.cloudCover?.sg ?? 0);
        dailyData[date].windSpeeds.push((hour.windSpeed?.sg ?? 0) * 3.6);
        dailyData[date].waveHeights.push(hour.waveHeight?.sg ?? 0);
        dailyData[date].waterTemps.push(hour.waterTemperature?.sg ?? 0);
        dailyData[date].currentSpeeds.push(hour.currentSpeed?.sg ?? 0);

        if (hour.time.includes("T12:00")) {
            dailyData[date].windDirection = hour.windDirection?.sg ?? 0;
        }
    });

    const wwoByDate = wwoAstroTideData.reduce((acc, day) => {
        acc[day.date] = day;
        return acc;
    }, {});

    const finalForecast = [];
    Object.keys(dailyData).forEach(date => {
        const day = dailyData[date];
        const wwoDay = wwoByDate[date];
        if (!wwoDay) return;

        const maxtempC = Math.max(...day.temps).toFixed(0);
        const mintempC = Math.min(...day.temps).toFixed(0);
        const dailyTempAvg = (parseFloat(maxtempC) + parseFloat(mintempC)) / 2;
        const dailyPressure = day.pressures.reduce((a, b) => a + b, 0) / day.pressures.length;
        const dailyWindSpeedKph = Math.max(...day.windSpeeds);
        const avgCloudCover = day.cloudCovers.reduce((a, b) => a + b, 0) / day.cloudCovers.length;
        const dailyHumidity = day.humidities.reduce((a, b) => a + b, 0) / day.humidities.length;
        const waveHeightMax = Math.max(...day.waveHeights);
        const waterTempAvg = day.waterTemps.reduce((a, b) => a + b, 0) / day.waterTemps.length;
        const currentVelocityAvg = day.currentSpeeds.reduce((a, b) => a + b, 0) / day.currentSpeeds.length;
        const isNewOrFullMoon = wwoDay.astronomy[0].moon_phase.toLowerCase().includes('new moon') || wwoDay.astronomy[0].moon_phase.toLowerCase().includes('full moon');
        const hourlyTransformed = wwoDay.hourly.map(h => ({
            time: formatTimeToHHMM(h.time),
            tempC: h.tempC,
            weatherCode: h.weatherCode,
            weatherIconUrl: h.weatherIconUrl?.[0]?.value ?? null
        }));

        finalForecast.push({
            date: date,
            maxtempC, mintempC, dailyTempAvg, dailyPressure, dailyWindSpeedKph,
            avgCloudCover, dailyHumidity, waveHeightMax, waterTempAvg, currentVelocityAvg,
            isNewOrFullMoon, astronomy: wwoDay.astronomy, tides: wwoDay.tides,
            hourly: hourlyTransformed, // Ora anche Stormglass ha i dati orari corretti
        });
    });

    return {
        dateRange: `${format(parseISO(finalForecast[0].date), 'dd/MM')} - ${format(parseISO(finalForecast[finalForecast.length - 1].date), 'dd/MM')}`,
        fonti: "Stormglass.io & WorldWeatherOnline.com",
        forecast: finalForecast
    };
}
// --- NUOVO CODICE DA INCOLLARE (IN SOSTITUZIONE DELL'INTERO BLOCCO DI fetchStandardData E fetchAndProcessForecast) ---
// Funzione Helper che rimane per elaborare i dati grezzi. Ora non effettua la chiamata di rete.
function processStandardData(wwoData, openMeteoData) {
    const forecastData = wwoData.data.weather;
    if (!forecastData || forecastData.length === 0) {
        throw new Error("WWO API did not return data.");
    }

    const marineData = openMeteoData.hourly;
    const marineDataByDay = {};
    for (let i = 0; i < marineData.time.length; i++) {
        const date = marineData.time[i].split('T')[0];
        if (!marineDataByDay[date]) {
            marineDataByDay[date] = { wave_height: [], sea_surface_temperature: [], ocean_current_velocity: [] };
        }
        marineDataByDay[date].wave_height.push(marineData.wave_height[i]);
        marineDataByDay[date].sea_surface_temperature.push(marineData.sea_surface_temperature[i]);
        marineDataByDay[date].ocean_current_velocity.push(marineData.ocean_current_velocity[i]);
    }
    
    const processedForecast = forecastData.map(dailyData => {
        // ... (La logica interna di processamento è la stessa, ma ora non ha effetti collaterali)
        const dateString = dailyData.date;
        const dayMarineData = marineDataByDay[dateString];
        const hourlyTransformed = dailyData.hourly.map(h => ({ time: formatTimeToHHMM(h.time), tempC: h.tempC, weatherCode: h.weatherCode, weatherIconUrl: h.weatherIconUrl?.[0]?.value ?? null }));
        const maxtempC = parseFloat(dailyData.maxtempC);
        const mintempC = parseFloat(dailyData.mintempC);
        const dailyTempAvg = (maxtempC + mintempC) / 2;
        const dailyPressure = dailyData.hourly.map(h => parseFloat(h.pressure)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const dailyWindSpeedKph = Math.max(...dailyData.hourly.map(h => parseFloat(h.windspeedKmph)));
        const avgCloudCover = dailyData.hourly.map(h => parseFloat(h.cloudcover)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const dailyHumidity = dailyData.hourly.map(h => parseFloat(h.humidity)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const isNewOrFullMoon = dailyData.astronomy[0].moon_phase.toLowerCase().includes('new moon') || dailyData.astronomy[0].moon_phase.toLowerCase().includes('full moon');
        let waveHeightMax = null, waterTempAvg = null, currentVelocityAvg = null;
        if (dayMarineData) {
            waveHeightMax = Math.max(...dayMarineData.wave_height);
            waterTempAvg = dayMarineData.sea_surface_temperature.reduce((a, b) => a + b, 0) / dayMarineData.sea_surface_temperature.length;
            currentVelocityAvg = dayMarineData.ocean_current_velocity.reduce((a, b) => a + b, 0) / dayMarineData.ocean_current_velocity.length;
        }
        return {
            date: dateString, maxtempC, mintempC, dailyTempAvg, dailyPressure, dailyWindSpeedKph,
            avgCloudCover, dailyHumidity, waveHeightMax, waterTempAvg, currentVelocityAvg,
            isNewOrFullMoon, astronomy: dailyData.astronomy, tides: dailyData.tides, hourly: hourlyTransformed,
        };
    });

    return {
        dateRange: `${format(parseISO(forecastData[0].date), 'dd/MM')} - ${format(parseISO(forecastData[forecastData.length - 1].date), 'dd/MM')}`,
        fonti: "WorldWeatherOnline.com & Open-Meteo.com",
        forecast: processedForecast
    };
}
async function fetchAndProcessForecast(location) {
    const [lat, lon] = location.split(',');
    const cacheKey = `forecast-data-v8-${location}`;
    let rawForecastData;
    const cachedData = myCache.get(cacheKey);

    if (cachedData) {
        console.log(`[${new Date().toISOString()}] Cache hit for ${location}.`);
        return cachedData;
    }

    if (location === POSILLIPO_COORDS) {
        console.log(`[${new Date().toISOString()}] Location is Posillipo. Attempting fetch with Stormglass...`);
        try {
            const wwoResponse = await axios.get(`https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${location}&format=json&tide=yes&fx=yes&day=7`);
            const stormglassData = await fetchStormglassData(lat, lon);

            rawForecastData = processStormglassData(stormglassData, wwoResponse.data.data.weather);
            
            console.log(`[${new Date().toISOString()}] Stormglass fetch and process successful for Posillipo.`);

        } catch (error) {
            console.warn(`[STORMGLASS FAILED] A critical error occurred: ${error.message}. Falling back to standard method.`);
            const [wwoResponse, openMeteoResponse] = await Promise.all([
                axios.get(`https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`),
                axios.get(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,sea_surface_temperature,ocean_current_velocity&forecast_days=7`)
            ]);
            rawForecastData = processStandardData(wwoResponse.data, openMeteoResponse.data);
        }
    } else {
        console.log(`[${new Date().toISOString()}] Location is not Posillipo. Fetching with standard method.`);
        const [wwoResponse, openMeteoResponse] = await Promise.all([
            axios.get(`https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`),
            axios.get(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,sea_surface_temperature,ocean_current_velocity&forecast_days=7`)
        ]);
        rawForecastData = processStandardData(wwoResponse, openMeteoResponse);
    }

    let previousDayData = null;
    const finalForecast = [];

    // Ora il ciclo itera su `rawForecastData.forecast` che è l'array elaborato
    for (let i = 0; i < rawForecastData.forecast.length; i++) {
        const dailyData = rawForecastData.forecast[i];
        
        let trendPressione = '→';
        if (previousDayData?.dailyPressure) {
            if (dailyData.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (dailyData.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }

        const scoreData = calculatePescaScore({
            trendPressione,
            dailyWindSpeedKph: dailyData.dailyWindSpeedKph,
            prevWindSpeed: previousDayData?.dailyWindSpeedKph || null,
            isNewOrFullMoon: dailyData.isNewOrFullMoon,
            avgCloudCover: dailyData.avgCloudCover,
            dailyPressure: dailyData.dailyPressure,
            waveHeightMax: dailyData.waveHeightMax,
            prevWaveHeightMax: previousDayData?.waveHeightMax || null,
            waterTempAvg: dailyData.waterTempAvg,
            currentVelocityAvg: dailyData.currentVelocityAvg,
            prevCurrentVelocityAvg: previousDayData?.currentVelocityAvg || null
        });

        const highTides = dailyData.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = dailyData.tides[0].tide_data.filter(t=>t.tide_type === 'LOW');
        const { finestraMattino, finestraSera } = calcolaFinestrePesca(dailyData.astronomy[0].sunrise, dailyData.astronomy[0].sunset, highTides, lowTides, scoreData.displayScore);
        
        const swellHeight_m = dailyData.waveHeightMax;

        // Recuperiamo la direzione del vento dal dato orario delle 12:00
        const middayHourlyData = dailyData.hourly.find(h => h.time.includes("12:00"));
        let windDirection = '';
        if (middayHourlyData && middayHourlyData.winddir16Point) {
          windDirection = middayHourlyData.winddir16Point;
        }

        finalForecast.push({
            giornoNome: capitalize(format(parseISO(dailyData.date), 'eee', {
                locale: it
            })),
            giornoData: format(parseISO(dailyData.date), 'dd/MM', {
                locale: it
            }),
            meteoIcon: getMeteoIconFromCode(dailyData.hourly[4].weatherCode),
            moon_phase: dailyData.astronomy[0].moon_phase,
            alba: `☀️ ${formatTimeToHHMM(dailyData.astronomy[0].sunrise)}`,
            tramonto: `${formatTimeToHHMM(dailyData.astronomy[0].sunset)}`,
            maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaAvg: dailyData.dailyTempAvg.toFixed(0),
            temperaturaMax: dailyData.maxtempC,
            temperaturaMin: dailyData.mintempC,
            pressione: dailyData.dailyPressure.toFixed(0),
            umidita: dailyData.dailyHumidity.toFixed(0),
            trendPressione,
            ventoDati: `${(dailyData.dailyWindSpeedKph).toFixed(0)} km/h ${windDirection}`.trim(),
            pescaScoreData: scoreData,
            pescaScore: scoreData.displayScore,
            sfondo: scoreData.displayScore >= 5 ? '#1E436E' : '#0D2A4B',
            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(swellHeight_m),
            temperaturaAcqua: dailyData.waterTempAvg !== null ? dailyData.waterTempAvg.toFixed(0) : 'N/D',
            velocitaCorrente: dailyData.currentVelocityAvg !== null ? (dailyData.currentVelocityAvg * 1.94384).toFixed(1) : 'N/D',
            hourly: dailyData.hourly,
        });

        previousDayData = {
            dailyPressure: dailyData.dailyPressure,
            dailyWindSpeedKph: dailyData.dailyWindSpeedKph,
            waveHeightMax: dailyData.waveHeightMax,
            currentVelocityAvg: dailyData.currentVelocityAvg
        };
    }

    const apiResponse = {
        dateRange: rawForecastData.dateRange,
        fonti: rawForecastData.fonti,
        forecast: finalForecast
    };
    myCache.set(cacheKey, apiResponse);
    console.log(`[${new Date().toISOString()}] Data for ${location} (Source: ${apiResponse.fonti}) cached successfully.`);
    return apiResponse;
}

const capitalize = (s) => (s && s.charAt(0).toUpperCase() + s.slice(1)) || "";

function getSeaStateAcronym(height) {
    if (height === null || isNaN(height)) return '-';
    if (height < 0.1) return 'C';
    if (height < 0.5) return 'QC';
    if (height < 1.25) return 'PM';
    if (height < 2.5) return 'M';
    if (height < 4) return 'MM';
    if (height < 6) return 'A';
    if (height < 9) return 'MA';
    return 'G';
}

function formatTimeToHHMM(timeStr) {
    if (!timeStr) return 'N/D';

    // Gestisce il formato da WWO API (es. "0", "300", "600", "1200")
    if (!isNaN(timeStr) && !timeStr.includes(':')) {
        const paddedTime = timeStr.padStart(4, '0'); // Es. "600" -> "0600"
        return `${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}`;
    }
    
    // Gestisce formati con AM/PM (es. "1:00 AM")
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        if (modifier === 'PM' && hours !== '12') {
            hours = parseInt(hours, 10) + 12;
        }
        if (modifier === 'AM' && hours === '12') {
            hours = '00';
        }
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
    
    // Se il formato è già HH:MM, lo restituisce
    if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }

    return 'N/D'; // Fallback
}

function getMeteoIconFromCode(code) {
    const codeNum = parseInt(code);
    if ([113].includes(codeNum)) return '☀️';
    if ([116, 119, 122].includes(codeNum)) return '☁️';
    if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(codeNum)) return '🌧️';
    if ([386, 389, 392, 395].includes(codeNum)) return '⛈️';
    if ([179, 182, 185, 323, 326, 329, 332, 335, 338, 368, 371].includes(codeNum)) return '❄️';
    return '🌤️';
}

function timeToHours(timeStr) {
    const [hours, minutes] = formatTimeToHHMM(timeStr).split(':');
    return parseInt(hours) + parseInt(minutes) / 60;
}

function calcolaFinestrePesca(sunrise, sunset, highTides, lowTides, score) {
    if (score <= 2) {
        return {
            finestraMattino: {
                orario: "Sconsigliato"
            },
            finestraSera: {
                orario: "Sconsigliato"
            }
        };
    }

    const eventi = {
        alba: {
            ora: timeToHours(sunrise),
            peso: 10,
            tipo: "Alba"
        },
        tramonto: {
            ora: timeToHours(sunset),
            peso: 10,
            tipo: "Tramonto"
        }
    };

    let pesoMarea = score >= 4 ? 10 : 7;
    const mareeMattino = [...highTides, ...lowTides].filter(t => timeToHours(t.tideTime) < 14).sort((a, b) => Math.abs(timeToHours(a.tideTime) - eventi.alba.ora) - Math.abs(timeToHours(b.tideTime) - eventi.alba.ora));
    const mareeSera = [...highTides, ...lowTides].filter(t => timeToHours(t.tideTime) >= 14).sort((a, b) => Math.abs(timeToHours(a.tideTime) - eventi.tramonto.ora) - Math.abs(timeToHours(b.tideTime) - eventi.tramonto.ora));

    let eventoTopMattino = eventi.alba;
    if (mareeMattino.length > 0) {
        const mareaTopMattino = mareeMattino[0];
        if (pesoMarea > eventoTopMattino.peso || Math.abs(eventi.alba.ora - timeToHours(mareaTopMattino.tideTime)) < 2) {
            eventoTopMattino = {
                ora: timeToHours(mareaTopMattino.tideTime),
                peso: pesoMarea,
                tipo: `${mareaTopMattino.tide_type === 'HIGH' ? 'Alta' : 'Bassa'} Marea`
            };
        }
    }

    let eventoTopSera = eventi.tramonto;
    if (mareeSera.length > 0) {
        const mareaTopSera = mareeSera[0];
        if (pesoMarea > eventoTopSera.peso || Math.abs(eventi.tramonto.ora - timeToHours(mareaTopSera.tideTime)) < 2) {
            eventoTopSera = {
                ora: timeToHours(mareaTopSera.tideTime),
                peso: pesoMarea,
                tipo: `${mareaTopSera.tide_type === 'HIGH' ? 'Alta' : 'Bassa'} Marea`
            };
        }
    }

    const formatFinestra = (ora) => {
        const oraInizio = ora - 1;
        const oraFine = ora + 1;
        return `${String(Math.floor(oraInizio)).padStart(2, '0')}:${String(Math.round((oraInizio % 1) * 60)).padStart(2, '0')} - ${String(Math.floor(oraFine)).padStart(2, '0')}:${String(Math.round((oraFine % 1) * 60)).padStart(2, '0')}`;
    };

    return {
        finestraMattino: {
            orario: formatFinestra(eventoTopMattino.ora)
        },
        finestraSera: {
            orario: formatFinestra(eventoTopSera.ora)
        }
    };
}

module.exports = {
    myCache,
    fetchAndProcessForecast
};
