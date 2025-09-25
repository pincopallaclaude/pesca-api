// /lib/forecast.assembler.js

const { calculateHourlyPescaScore } = require('./domain/score.calculator');
const { findBestTimeWindow } = require('./domain/window.calculator');
const { convertWmoToWwoCode, degreesTo16PointDirection } = require('./utils/wmo_code_converter');
const { format, parseISO, it, capitalize, getMeteoIconFromCode, getSeaStateAcronym, formatTimeToHHMM } = require('./utils/formatter');

// Funzione helper per garantire che un valore sia un numero valido
const safeNum = (val, decimals = 1) => {
    const num = Number(val);
    return isNaN(num) ? null : parseFloat(num.toFixed(decimals));
};

// *********** QUESTA FUNZIONE MANCAVA ***********
function combineStandardData(wwoData, openMeteoDataByDay) {
    return wwoData.map(day => {
        const date = day.date;
        const hourlyData = openMeteoDataByDay[date] || [];
        if (hourlyData.length === 0) return { ...day };

        const hourlyTransformed = hourlyData.map(h => ({
            time: h.time,
            tempC: safeNum(h.temperature, 0),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            weatherIconUrl: '', // Obsoleto, ma lo teniamo per compatibilità
            winddir16Point: degreesTo16PointDirection(h.windDirection)
        }));

        return {
            ...day,
            maxtempC: Math.max(...hourlyData.map(h => h.temperature)),
            mintempC: Math.min(...hourlyData.map(h => h.temperature)),
            dailyTempAvg: hourlyData.map(h => h.temperature).reduce((a, b) => a + b, 0) / hourlyData.length,
            waveHeightMax: Math.max(...hourlyData.map(h => h.waveHeight)),
            waterTempAvg: hourlyData.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / hourlyData.length,
            currentVelocityAvg: hourlyData.map(h => h.currentVelocity).filter(v => v !== null).reduce((a, b) => a + b, 0) / hourlyData.filter(v => v.currentVelocity !== null).length,
            dailyPressure: hourlyData.map(h => h.pressure).reduce((a, b) => a + b, 0) / hourlyData.length,
            dailyWindSpeedKph: Math.max(...hourlyData.map(h => h.windSpeed)),
            avgCloudCover: hourlyData.map(h => h.cloudCover).reduce((a, b) => a + b, 0) / hourlyData.length,
            dailyHumidity: hourlyData.map(h => h.humidity).reduce((a, b) => a + b, 0) / hourlyData.length,
            hourly: hourlyTransformed,
        };
    });
}

// *********** E MANCAVA ANCHE QUESTA ***********
function combineStormglassData(stormglassAggregates, wwoData, openMeteoDataByDay) {
    return wwoData.map(day => {
        const sgDay = stormglassAggregates[day.date];
        const hourlyOpenMeteo = openMeteoDataByDay[day.date] || [];
        if (!sgDay || hourlyOpenMeteo.length === 0) return null;

        // USA I DATI ORARI DETTAGLIATI DI OPENMETEO ANCHE QUI
        const hourlyTransformed = hourlyOpenMeteo.map(h => ({
            time: h.time,
            tempC: h.temperature.toFixed(0),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            weatherIconUrl: '',
            winddir16Point: degreesTo16PointDirection(h.windDirection)
        }));

        const maxtempC = Math.max(...sgDay.airTemps.filter(t => t !== null));
        const mintempC = Math.min(...sgDay.airTemps.filter(t => t !== null));
        
        return {
            ...day, // Mantiene maree, astronomia da WWO
            maxtempC, mintempC,
            // Usa dati Stormglass per precisione, con fallback a OpenMeteo se necessario
            dailyTempAvg: (maxtempC + mintempC) / 2,
            dailyPressure: sgDay.pressures.filter(p => p !== null).reduce((a, b) => a + b, 0) / sgDay.pressures.length,
            dailyWindSpeedKph: Math.max(...sgDay.windSpeeds),
            avgCloudCover: sgDay.cloudCovers.filter(c => c !== null).reduce((a, b) => a + b, 0) / sgDay.cloudCovers.length,
            dailyHumidity: sgDay.humidities.filter(h => h !== null).reduce((a, b) => a + b, 0) / sgDay.humidities.length,
            waveHeightMax: Math.max(...sgDay.waveHeights.filter(wh => wh !== null)),
            waterTempAvg: sgDay.waterTemps.filter(wt => wt !== null).reduce((a, b) => a + b, 0) / sgDay.waterTemps.length,
            currentVelocityAvg: sgDay.currentSpeeds.filter(cs => cs !== null).reduce((a, b) => a + b, 0) / sgDay.currentSpeeds.length,
            hourly: hourlyTransformed, // USA I DATI ORARI CORRETTI
        };
    }).filter(Boolean);
}

function processAndAssemble(unifiedForecastData) {
    let previousDayData = null;
    const finalForecast = [];

    for (const day of unifiedForecastData) {
        if (!day || !day.date || !day.hourly || day.hourly.length < 5) {
            console.error('[ASSEMBLER-ERROR] Skipping day with malformed data:', { date: day.date, hourlyCount: day.hourly?.length });
            continue; 
        }

        let trendPressione = '→';
        if (previousDayData?.dailyPressure && day.dailyPressure) {
            if (day.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (day.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }
        
        // 1. Calcola lo score per OGNI ORA
        const hourlyScores = day.hourly.map(hourData => {
            const hour = parseInt(hourData.time.split(':')[0], 10);
            const score = calculateHourlyPescaScore({
                pressure: day.dailyPressure, // Usiamo ancora i dati aggregati dove non abbiamo dettaglio orario
                trendPressione,
                windSpeedKph: hourData.windSpeed,
                isNewOrFullMoon: day.isNewOrFullMoon,
                cloudCover: hourData.cloudCover,
                waveHeight: hourData.waveHeight,
                waterTemp: hourData.waterTemperature,
                currentVelocity: hourData.currentVelocity,
            });
            return {
                hour: hour,
                score: score.numericScore,
                displayScore: score.displayScore
            };
        });
        
        // 2. Trova le migliori finestre di tempo
        const morningWindow = findBestTimeWindow(hourlyScores, 4, 13); // Dalle 4:00 alle 13:00
        const eveningWindow = findBestTimeWindow(hourlyScores, 14, 22); // Dalle 14:00 alle 22:00
        
        const finestraMattino = { orario: morningWindow ?? 'Dati insuff.' };
        const finestraSera = { orario: eveningWindow ?? 'Dati insuff.' };
        
        // Lo score giornaliero ora può essere la MEDIA o il MASSIMO degli score orari
        const avgNumericScore = hourlyScores.reduce((sum, h) => sum + h.score, 0) / hourlyScores.length;
        
        const highTides = day.tides?.[0]?.tide_data?.filter(t => t.tide_type === 'HIGH') ?? [];
        const lowTides = day.tides?.[0]?.tide_data?.filter(t => t.tide_type === 'LOW') ?? [];

        finalForecast.push({
            giornoNome: capitalize(format(parseISO(day.date), 'eee', { locale: it })),
            giornoData: format(parseISO(day.date), 'dd/MM'),
            meteoIcon: getMeteoIconFromCode(day.hourly.find(h => parseInt(h.time.split(':')[0]) >= new Date().getHours())?.weatherCode ?? day.hourly[4].weatherCode),
            moon_phase: day.astronomy?.[0]?.moon_phase ?? 'N/A',
            alba: `☀️ ${formatTimeToHHMM(day.astronomy?.[0]?.sunrise)}`,
            tramonto: formatTimeToHHMM(day.astronomy?.[0]?.sunset),
            maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaAvg: (day.dailyTempAvg ?? 0).toFixed(0),
            temperaturaMax: day.maxtempC ?? 0,
            temperaturaMin: day.mintempC ?? 0,
            pressione: (day.dailyPressure ?? 0).toFixed(0),
            umidita: (day.dailyHumidity ?? 0).toFixed(0),
            trendPressione,
            ventoDati: `${((day.dailyWindSpeedKph ?? 0) / 1.852).toFixed(0)} kn ${day.hourly[4]?.winddir16Point ?? ''}`,
            
            // AGGIUNGIAMO LA NUOVA SERIE DI DATI E AGGIORNIAMO IL VECCHIO SCORE
            pescaScoreData: {
                numericScore: avgNumericScore,
                displayScore: Math.min(5, Math.max(1, Math.round(avgNumericScore))),
                hourlyScores: hourlyScores.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score })),
            },

            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(day.hourly[4]?.swellHeight_m),
            temperaturaAcqua: String(safeNum(day.waterTempAvg, 0) ?? 'N/D'),
            velocitaCorrente: String(safeNum(day.currentVelocityAvg * 1.94384, 1) ?? 'N/D'),
            hourly: day.hourly, // L'array con tutti i dati orari
        });
        
        previousDayData = day;
    }
    
    return finalForecast;
}

module.exports = { combineStandardData, combineStormglassData, processAndAssemble };