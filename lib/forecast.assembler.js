// /lib/forecast.assembler.js

const { calculatePescaScore } = require('./domain/score.calculator');
const { calcolaFinestrePesca } = require('./domain/window.calculator');
const { convertWmoToWwoCode, degreesTo16PointDirection } = require('./utils/wmo_code_converter');
const { format, parseISO, it, capitalize, getMeteoIconFromCode, getSeaStateAcronym, formatTimeToHHMM } = require('./utils/formatter');

// Combina dati da WWO (base) e OpenMeteo (dettagli orari)
function combineStandardData(wwoData, openMeteoDataByDay) {
    return wwoData.map(day => {
        const date = day.date;
        const hourlyData = openMeteoDataByDay[date] || [];

        if (hourlyData.length === 0) {
            // Se non ci sono dati orari di OpenMeteo, restituiamo i dati di WWO com'erano
            // per evitare crash. Aggiungiamo campi nulli per coerenza.
            return {
                ...day,
                waveHeightMax: null,
                waterTempAvg: null,
                currentVelocityAvg: null,
                dailyPressure: day.hourly.map(h => h.pressure).reduce((a, b) => a + b, 0) / day.hourly.length,
                dailyWindSpeedKph: Math.max(...day.hourly.map(h => h.windspeedKmph)),
                avgCloudCover: day.hourly.map(h => h.cloudcover).reduce((a, b) => a + b, 0) / day.hourly.length,
                dailyHumidity: day.hourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / day.hourly.length,
            };
        }

        // Calcola medie e massimi dai nuovi dati orari ad alta risoluzione
        const dailyWindSpeedKph = Math.max(...hourlyData.map(h => h.windSpeed));
        const avgCloudCover = hourlyData.map(h => h.cloudCover).reduce((a, b) => a + b, 0) / hourlyData.length;
        const dailyPressure = hourlyData.map(h => h.pressure).reduce((a, b) => a + b, 0) / hourlyData.length;
        const dailyHumidity = hourlyData.map(h => h.humidity).reduce((a, b) => a + b, 0) / hourlyData.length;
        const waveHeightMax = Math.max(...hourlyData.map(h => h.waveHeight));
        const waterTempAvg = hourlyData.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / hourlyData.length;
        const currentVelocityAvg = hourlyData.map(h => h.currentVelocity).filter(v => v !== null).reduce((a, b) => a + b, 0) / hourlyData.length;

        const hourlyTransformed = hourlyData.map(h => ({
            time: h.time,
            tempC: h.temperature.toFixed(0),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            weatherIconUrl: '',
            winddir16Point: degreesTo16PointDirection(h.windDirection)
        }));

        return {
            ...day, // Mantiene astronomia e maree da WWO
            maxtempC: Math.max(...hourlyData.map(h => h.temperature)),
            mintempC: Math.min(...hourlyData.map(h => h.temperature)),
            dailyTempAvg: (Math.max(...hourlyData.map(h => h.temperature)) + Math.min(...hourlyData.map(h => h.temperature))) / 2,
            waveHeightMax, waterTempAvg, currentVelocityAvg, dailyPressure,
            dailyWindSpeedKph, avgCloudCover, dailyHumidity,
            hourly: hourlyTransformed,
        };
    });
}

// Combina dati da Stormglass (aggregati) e WWO (dettagli)
function combineStormglassData(stormglassAggregates, wwoData) {
     return wwoData.map(day => {
        const sgDay = stormglassAggregates[day.date];
        if (!sgDay) return null;

        const maxtempC = Math.max(...sgDay.airTemps.filter(t => t !== null));
        const mintempC = Math.min(...sgDay.airTemps.filter(t => t !== null));
        
        return {
            ...day, // Mantiene maree, astronomia e dati orari grezzi da WWO
            maxtempC, mintempC,
            dailyTempAvg: (maxtempC + mintempC) / 2,
            dailyPressure: sgDay.pressures.filter(p => p !== null).reduce((a, b) => a + b, 0) / sgDay.pressures.length,
            dailyWindSpeedKph: Math.max(...sgDay.windSpeeds),
            avgCloudCover: sgDay.cloudCovers.filter(c => c !== null).reduce((a, b) => a + b, 0) / sgDay.cloudCovers.length,
            dailyHumidity: sgDay.humidities.filter(h => h !== null).reduce((a, b) => a + b, 0) / sgDay.humidities.length,
            waveHeightMax: Math.max(...sgDay.waveHeights.filter(wh => wh !== null)),
            waterTempAvg: sgDay.waterTemps.filter(wt => wt !== null).reduce((a, b) => a + b, 0) / sgDay.waterTemps.length,
            currentVelocityAvg: sgDay.currentSpeeds.filter(cs => cs !== null).reduce((a, b) => a + b, 0) / sgDay.currentSpeeds.length,
        };
     }).filter(Boolean);
}

// L'UNICA FUNZIONE CHE PREPARA IL JSON FINALE
function processAndAssemble(unifiedForecastData) {
    let previousDayData = null;
    const finalForecast = [];

    for (const day of unifiedForecastData) {
        if (!day || !day.date || !day.hourly || day.hourly.length < 5) continue; // Salta i giorni con dati corrotti

        let trendPressione = '→';
        if (previousDayData?.dailyPressure) {
            if (day.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (day.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }

        const scoreData = calculatePescaScore({
            trendPressione, dailyWindSpeedKph: day.dailyWindSpeedKph,
            prevWindSpeed: previousDayData?.dailyWindSpeedKph, isNewOrFullMoon: day.isNewOrFullMoon,
            avgCloudCover: day.avgCloudCover, dailyPressure: day.dailyPressure,
            waveHeightMax: day.waveHeightMax, prevWaveHeightMax: previousDayData?.waveHeightMax,
            waterTempAvg: day.waterTempAvg, currentVelocityAvg: day.currentVelocityAvg,
            prevCurrentVelocityAvg: previousDayData?.currentVelocityAvg
        });

        const highTides = day.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = day.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        
        const { finestraMattino, finestraSera } = calcolaFinestrePesca(
            day.astronomy[0].sunrise, day.astronomy[0].sunset,
            highTides, lowTides, scoreData.displayScore
        );
        
        finalForecast.push({
            giornoNome: capitalize(format(parseISO(day.date), 'eee', { locale: it })),
            giornoData: format(parseISO(day.date), 'dd/MM'),
            meteoIcon: getMeteoIconFromCode(day.hourly[4].weatherCode),
            moon_phase: day.astronomy[0].moon_phase,
            alba: `☀️ ${formatTimeToHHMM(day.astronomy[0].sunrise)}`,
            tramonto: formatTimeToHHMM(day.astronomy[0].sunset),
            maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaAvg: day.dailyTempAvg.toFixed(0),
            temperaturaMax: day.maxtempC,
            temperaturaMin: day.mintempC,
            pressione: day.dailyPressure.toFixed(0),
            umidita: day.dailyHumidity.toFixed(0),
            trendPressione,
            ventoDati: `${(day.dailyWindSpeedKph / 1.852).toFixed(0)} kn ${day.hourly[4]?.winddir16Point ?? ''}`,
            pescaScoreData: scoreData,
            pescaScore: scoreData.displayScore,
            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(day.hourly[4].swellHeight_m),
            temperaturaAcqua: day.waterTempAvg?.toFixed(0) ?? 'N/D',
            velocitaCorrente: day.currentVelocityAvg ? (day.currentVelocityAvg * 1.94384).toFixed(1) : 'N/D',
            hourly: day.hourly,
        });
        
        previousDayData = day;
    }
    
    return finalForecast;
}

// Rinominiamo la vecchia 'assembleFinalForecast' per chiarezza.
module.exports = { combineStandardData, combineStormglassData, processAndAssemble };