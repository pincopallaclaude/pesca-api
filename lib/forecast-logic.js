// /lib/forecast-logic.js
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

    // 1. Aggrega i dati orari di Stormglass per giorno
    stormglassData.hours.forEach(hour => {
        const date = hour.time.split('T')[0];
        if (!dailyData[date]) {
            dailyData[date] = { temps: [], pressures: [], humidities: [], cloudCovers: [], windSpeeds: [], waveHeights: [], waterTemps: [], currentSpeeds: [] };
        }
        dailyData[date].temps.push(hour.airTemperature?.sg ?? 0);
        dailyData[date].pressures.push(hour.pressure?.sg ?? 0);
        dailyData[date].humidities.push(hour.humidity?.sg ?? 0);
        dailyData[date].cloudCovers.push(hour.cloudCover?.sg ?? 0);
        dailyData[date].windSpeeds.push((hour.windSpeed?.sg ?? 0) * 3.6);
        dailyData[date].waveHeights.push(hour.waveHeight?.sg ?? 0);
        dailyData[date].waterTemps.push(hour.waterTemperature?.sg ?? 0);
        dailyData[date].currentSpeeds.push(hour.currentSpeed?.sg ?? 0);
    });

    // Mappa i dati di WWO per un accesso facile
    const wwoByDate = wwoAstroTideData.reduce((acc, day) => {
        acc[day.date] = day;
        return acc;
    }, {});
    
    // 2. Costruisce l'output finale giorno per giorno, COMBINANDO i dati
    const finalForecast = Object.keys(dailyData).map(date => {
        const day = dailyData[date];
        const wwoDay = wwoByDate[date];
        if (!wwoDay) return null; // Salta il giorno se mancano i dati WWO

        // Prendi i dati orari da WWO e trasformali
        const hourlyTransformed = wwoDay.hourly.map(h => ({
            time: formatTimeToHHMM(h.time),
            tempC: h.tempC,
            weatherCode: h.weatherCode,
            weatherIconUrl: h.weatherIconUrl?.[0]?.value ?? null,
            winddir16Point: h.winddir16Point // <<<----- AGGIUNTA FONDAMENTALE
        }));

        const maxtempC = Math.max(...day.temps);
        const mintempC = Math.min(...day.temps);
        
        // Costruisci l'oggetto finale nello stesso formato di fetchStandardData
        return {
            date: date,
            maxtempC: maxtempC,
            mintempC: mintempC,
            dailyTempAvg: (maxtempC + mintempC) / 2,
            dailyPressure: day.pressures.reduce((a, b) => a + b, 0) / day.pressures.length,
            dailyWindSpeedKph: Math.max(...day.windSpeeds),
            avgCloudCover: day.cloudCovers.reduce((a, b) => a + b, 0) / day.cloudCovers.length,
            dailyHumidity: day.humidities.reduce((a, b) => a + b, 0) / day.humidities.length,
            waveHeightMax: Math.max(...day.waveHeights),
            waterTempAvg: day.waterTemps.reduce((a, b) => a + b, 0) / day.waterTemps.length,
            currentVelocityAvg: day.currentSpeeds.reduce((a, b) => a + b, 0) / day.currentSpeeds.length,
            isNewOrFullMoon: wwoDay.astronomy[0].moon_phase.toLowerCase().includes('new moon') || wwoDay.astronomy[0].moon_phase.toLowerCase().includes('full moon'),
            astronomy: wwoDay.astronomy,
            tides: wwoDay.tides,
            hourly: hourlyTransformed, // L'oggetto completo, che ora include winddir16Point
        };
    }).filter(Boolean); // Rimuovi eventuali giorni nulli

    return {
        dateRange: `${format(parseISO(finalForecast[0].date), 'dd/MM')} - ${format(parseISO(finalForecast[finalForecast.length - 1].date), 'dd/MM')}`,
        fonti: "Stormglass.io & WorldWeatherOnline.com",
        forecast: finalForecast
    };
}

// Riscriviamo l'intera funzione per una maggiore chiarezza e per garantire
// la corretta propagazione dei dati orari trasformati.
async function fetchStandardData(lat, lon) {
    const forecastDays = 7;
    const [wwoResponse, openMeteoResponse] = await Promise.all([
        axios.get(`https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=${forecastDays}`),
        axios.get(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,sea_surface_temperature,ocean_current_velocity&forecast_days=${forecastDays}`)
    ]);

    const forecastData = wwoResponse.data.data.weather;
    if (!forecastData || forecastData.length === 0) {
        throw new Error("WWO API did not return data.");
    }

    const marineData = openMeteoResponse.data.hourly;
    const marineDataByDay = {};
    for (let i = 0; i < marineData.time.length; i++) {
        const date = marineData.time[i].split('T')[0];
        if (!marineDataByDay[date]) {
            marineDataByDay[date] = {
                wave_height: [],
                sea_surface_temperature: [],
                ocean_current_velocity: []
            };
        }
        marineDataByDay[date].wave_height.push(marineData.wave_height[i]);
        marineDataByDay[date].sea_surface_temperature.push(marineData.sea_surface_temperature[i]);
        marineDataByDay[date].ocean_current_velocity.push(marineData.ocean_current_velocity[i]);
    }

    // Ora processedForecast conterrà DIRETTAMENTE i dati orari corretti
    const processedForecast = forecastData.map(dailyData => {
        const dateString = dailyData.date;
        const dayMarineData = marineDataByDay[dateString];

        const hourlyTransformed = dailyData.hourly.map(h => ({
            time: formatTimeToHHMM(h.time),
            tempC: h.tempC,
            weatherCode: h.weatherCode,
            weatherIconUrl: h.weatherIconUrl?.[0]?.value ?? null,
            winddir16Point: h.winddir16Point // <<<----- AGGIUNTA FONDAMENTALE
        }));

        const maxtempC = parseFloat(dailyData.maxtempC);
        const mintempC = parseFloat(dailyData.mintempC);
        const dailyTempAvg = (maxtempC + mintempC) / 2;
        const dailyPressure = dailyData.hourly.map(h => parseFloat(h.pressure)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const dailyWindSpeedKph = Math.max(...dailyData.hourly.map(h => parseFloat(h.windspeedKmph)));
        const avgCloudCover = dailyData.hourly.map(h => parseFloat(h.cloudcover)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const dailyHumidity = dailyData.hourly.map(h => parseFloat(h.humidity)).reduce((a, b) => a + b, 0) / dailyData.hourly.length;
        const isNewOrFullMoon = dailyData.astronomy[0].moon_phase.toLowerCase().includes('new moon') || dailyData.astronomy[0].moon_phase.toLowerCase().includes('full moon');

        let waveHeightMax = null,
            waterTempAvg = null,
            currentVelocityAvg = null;
        if (dayMarineData) {
            waveHeightMax = Math.max(...dayMarineData.wave_height);
            waterTempAvg = dayMarineData.sea_surface_temperature.reduce((a, b) => a + b, 0) / dayMarineData.sea_surface_temperature.length;
            currentVelocityAvg = dayMarineData.ocean_current_velocity.reduce((a, b) => a + b, 0) / dayMarineData.ocean_current_velocity.length;
        }

        return {
            date: dateString,
            maxtempC,
            mintempC,
            dailyTempAvg,
            dailyPressure,
            dailyWindSpeedKph,
            avgCloudCover,
            dailyHumidity,
            waveHeightMax,
            waterTempAvg,
            currentVelocityAvg,
            isNewOrFullMoon,
            astronomy: dailyData.astronomy,
            tides: dailyData.tides,
            hourly: hourlyTransformed, // L'array corretto è qui dentro
        };
    });

    return {
        dateRange: `${format(parseISO(forecastData[0].date), 'dd/MM')} - ${format(parseISO(forecastData[forecastData.length - 1].date), 'dd/MM')}`,
        fonti: "WorldWeatherOnline.com & Open-Meteo.com",
        forecast: processedForecast
    };
}

function calculatePescaScore(params) {
    let score = 3.0;
    const reasons = [];
    const {
        trendPressione,
        dailyWindSpeedKph,
        prevWindSpeed,
        isNewOrFullMoon,
        avgCloudCover,
        dailyPressure,
        waveHeightMax,
        prevWaveHeightMax,
        waterTempAvg,
        currentVelocityAvg,
        prevCurrentVelocityAvg
    } = params;

    if (trendPressione === '↓') {
        score += 1.5;
        reasons.push({
            icon: 'pressure_down',
            text: "Pressione in calo",
            points: "+1.5",
            type: "positive"
        });
    } else if (trendPressione === '↑') {
        score -= 1.0;
        reasons.push({
            icon: 'pressure_up',
            text: "Pressione in aumento",
            points: "-1.0",
            type: "negative"
        });
    } else {
        reasons.push({
            icon: 'pressure',
            text: "Pressione stabile",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (prevWindSpeed > 30 && dailyWindSpeedKph < prevWindSpeed) {
        score += 2.0;
        reasons.push({
            icon: 'wind',
            text: "Vento in calo",
            points: "+2.0",
            type: "positive"
        });
    } else if (dailyWindSpeedKph > 5 && dailyWindSpeedKph < 20) {
        score += 1.0;
        reasons.push({
            icon: 'wind',
            text: "Vento ideale",
            points: "+1.0",
            type: "positive"
        });
    } else if (dailyWindSpeedKph > 30) {
        score -= 2.0;
        reasons.push({
            icon: 'wind',
            text: "Vento troppo forte",
            points: "-2.0",
            type: "negative"
        });
    } else {
        reasons.push({
            icon: 'wind',
            text: "Condizioni vento neutre",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (isNewOrFullMoon) {
        score += 1.0;
        reasons.push({
            icon: 'moon',
            text: "Fase lunare favorevole",
            points: "+1.0",
            type: "positive"
        });
    } else {
        reasons.push({
            icon: 'moon',
            text: "Fase lunare neutra",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (avgCloudCover > 60) {
        score += 1.0;
        reasons.push({
            icon: 'clouds',
            text: "Cielo molto nuvoloso",
            points: "+1.0",
            type: "positive"
        });
    } else if (avgCloudCover < 20 && dailyPressure > 1018) {
        score -= 1.0;
        reasons.push({
            icon: 'clouds',
            text: "Sereno con alta pressione",
            points: "-1.0",
            type: "negative"
        });
    } else {
        reasons.push({
            icon: 'clouds',
            text: "Copertura nuvolosa neutra",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (waveHeightMax !== null) {
        if (prevWaveHeightMax !== null && (waveHeightMax >= 1.25 && waveHeightMax < 2.5) && (prevWaveHeightMax >= 2.5)) {
            score += 2.0;
            reasons.push({
                icon: 'waves',
                text: "Mare in scaduta",
                points: "+2.0",
                type: "positive"
            });
        } else if (waveHeightMax >= 0.5 && waveHeightMax < 1.25) {
            score += 2.0;
            reasons.push({
                icon: 'waves',
                text: "Mare poco mosso (ideale)",
                points: "+2.0",
                type: "positive"
            });
        } else if (waveHeightMax >= 1.25 && waveHeightMax < 2.5) {
            score += 1.0;
            reasons.push({
                icon: 'waves',
                text: "Mare mosso",
                points: "+1.0",
                type: "positive"
            });
        } else if (waveHeightMax < 0.5) {
            score -= 1.0;
            reasons.push({
                icon: 'waves',
                text: "Mare calmo (negativo)",
                points: "-1.0",
                type: "negative"
            });
        } else if (waveHeightMax >= 2.5) {
            score -= 2.0;
            reasons.push({
                icon: 'waves',
                text: "Mare troppo agitato",
                points: "-2.0",
                type: "negative"
            });
        } else {
            reasons.push({
                icon: 'waves',
                text: "Stato del mare neutro",
                points: "+0.0",
                type: "neutral"
            });
        }
    } else {
        reasons.push({
            icon: 'waves',
            text: "Stato del mare N/D",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (waterTempAvg !== null) {
        if (waterTempAvg >= 12 && waterTempAvg <= 20) {
            score += 1.0;
            reasons.push({
                icon: 'water_temp',
                text: "Temp. acqua ottimale",
                points: "+1.0",
                type: "positive"
            });
        } else if (waterTempAvg < 10 || waterTempAvg > 24) {
            score -= 1.0;
            reasons.push({
                icon: 'water_temp',
                text: "Temp. acqua estrema",
                points: "-1.0",
                type: "negative"
            });
        } else {
            reasons.push({
                icon: 'water_temp',
                text: "Temp. acqua neutra",
                points: "+0.0",
                type: "neutral"
            });
        }
    } else {
        reasons.push({
            icon: 'water_temp',
            text: "Temp. acqua N/D",
            points: "+0.0",
            type: "neutral"
        });
    }

    if (currentVelocityAvg !== null) {
        if (prevCurrentVelocityAvg !== null) {
            const currentDiff = currentVelocityAvg - prevCurrentVelocityAvg;
            if (currentDiff < -0.1) {
                score += 1.0;
                reasons.push({
                    icon: 'currents',
                    text: "Correnti in calo",
                    points: "+1.0",
                    type: "positive"
                });
            } else if (currentDiff > 0.1) {
                score += 0.5;
                reasons.push({
                    icon: 'currents',
                    text: "Correnti in aumento",
                    points: "+0.5",
                    type: "positive"
                });
            } else {
                reasons.push({
                    icon: 'currents',
                    text: "Correnti stabili",
                    points: "+0.0",
                    type: "neutral"
                });
            }
        } else {
            reasons.push({
                icon: 'currents',
                text: "Correnti stabili",
                points: "+0.0",
                type: "neutral"
            });
        }
        if (currentVelocityAvg > 1.0) {
            score -= 1.0;
        }
    } else {
        reasons.push({
            icon: 'currents',
            text: "Correnti N/D",
            points: "+0.0",
            type: "neutral"
        });
    }

    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score))),
        reasons: reasons
    };
}

async function fetchAndProcessForecast(location) {
    const [lat, lon] = location.split(',');
    const cacheKey = `forecast-data-v9-${location}`; 
    let rawForecastData;

    if (location === POSILLIPO_COORDS) {
        console.log(`[${new Date().toISOString()}] Location is Posillipo. Attempting fetch with Stormglass...`);
        try {
            const wwoResponse = await axios.get(`https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${location}&format=json&tide=yes&fx=yes&day=7`);
            const wwoAstroTideData = wwoResponse.data.data.weather;
            const stormglassData = await fetchStormglassData(lat, lon);
            rawForecastData = processStormglassData(stormglassData, wwoAstroTideData);
        } catch (error) {
            console.warn(`[STORMGLASS FAILED] Error: ${error.response?.data?.errors?.key || error.message}. Falling back to standard method.`);
            rawForecastData = await fetchStandardData(lat, lon);
        }
    } else {
        console.log(`[${new Date().toISOString()}] Location is not Posillipo. Fetching with standard method.`);
        rawForecastData = await fetchStandardData(lat, lon);
    }

    let previousDayData = null;
    const finalForecast = [];

    if (rawForecastData.forecast.length > 0) {
        console.log('[DEBUG-1] Struttura di `rawForecastData.forecast[0].hourly` (primo giorno, prima di ogni elaborazione):');
        // Logghiamo i primi due elementi dell'array orario per vedere la struttura
        console.log(JSON.stringify(rawForecastData.forecast[0].hourly?.slice(0, 2), null, 2));
    }    

    for (const dailyData of rawForecastData.forecast) {
        let trendPressione = '→';
        if (previousDayData?.pressure) {
            if (dailyData.dailyPressure < previousDayData.pressure - 0.5) {
                trendPressione = '↓';
            } else if (dailyData.dailyPressure > previousDayData.pressure + 0.5) {
                trendPressione = '↑';
            }
        }

        console.log(`[DEBUG-2] Inizio elaborazione per ${dailyData.date}. Verifico l'oggetto dailyData.hourly[4]:`);
        console.log(JSON.stringify(dailyData.hourly?.[4], null, 2));

        const scoreData = calculatePescaScore({
            trendPressione,
            dailyWindSpeedKph: dailyData.dailyWindSpeedKph,
            prevWindSpeed: previousDayData?.windSpeed || null,
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
        const lowTides = dailyData.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        const {
            finestraMattino,
            finestraSera
        } = calcolaFinestrePesca(
            dailyData.astronomy[0].sunrise,
            dailyData.astronomy[0].sunset,
            highTides,
            lowTides,
            scoreData.displayScore
        );
        const swellHeight_m = parseFloat(dailyData.hourly[4].swellHeight_m);

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
            ventoDati: `${(dailyData.dailyWindSpeedKph / 1.852).toFixed(0)} kn ${dailyData.hourly[4]?.winddir16Point ?? 'ERR'}`,
            pescaScoreData: scoreData,
            pescaScore: scoreData.displayScore,
            sfondo: scoreData.displayScore >= 5 ? '#1E436E' : '#0D2A4B',
            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(swellHeight_m),
            temperaturaAcqua: dailyData.waterTempAvg !== null ? dailyData.waterTempAvg.toFixed(0) : 'N/D',
            velocitaCorrente: dailyData.currentVelocityAvg !== null ? (dailyData.currentVelocityAvg * 1.94384).toFixed(1) : 'N/D',
            // --- QUESTA È LA RIGA FONDAMENTALE DA AGGIUNGERE ---
            hourly: dailyData.hourly,
        });

        previousDayData = {
            pressure: dailyData.dailyPressure,
            windSpeed: dailyData.dailyWindSpeedKph,
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
    if (!timeStr.includes(':') && timeStr.length >= 3) {
        const time = timeStr.padStart(4, '0');
        return `${time.slice(0, 2)}:${time.slice(2)}`;
    }
    const [time, modifier] = timeStr.split(' ');
    let [hours, minutes] = time.split(':');
    if (modifier === 'PM' && hours !== '12') hours = parseInt(hours, 10) + 12;
    if (modifier === 'AM' && hours === '12') hours = '00';
    return `${String(hours).padStart(2, '0')}:${minutes}`;
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