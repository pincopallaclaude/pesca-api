// /lib/forecast.assembler.js
const { fetchWwoData } = require('./services/wwo.service');
const { fetchOpenMeteoData } = require('./services/openmeteo.service');
const { fetchStormglassData } = require('./services/stormglass.service');
const { calculatePescaScore } = require('./domain/score.calculator');
const { calcolaFinestrePesca } = require('./domain/window.calculator');
const { convertWmoToWwoCode, degreesTo16PointDirection } = require('./utils/wmo_code_converter');
const { format, parseISO, it, capitalize, getMeteoIconFromCode, getSeaStateAcronym, formatTimeToHHMM } = require('./utils/formatter');

// La funzione ora usa OpenMeteo come fonte principale per i dati orari.
function combineStandardData(wwoData, openMeteoDataByDay) {
    return wwoData.map(day => {
        const date = day.date;
        const hourlyData = openMeteoDataByDay[date] || [];

        // Aggreghiamo i dati giornalieri partendo dai dati orari di OpenMeteo (più precisi)
        const dailyWindSpeedKph = Math.max(...hourlyData.map(h => h.windSpeed));
        const avgCloudCover = hourlyData.map(h => h.cloudCover).reduce((a, b) => a + b, 0) / hourlyData.length;
        const dailyPressure = hourlyData.map(h => h.pressure).reduce((a, b) => a + b, 0) / hourlyData.length;
        const dailyHumidity = hourlyData.map(h => h.humidity).reduce((a, b) => a + b, 0) / hourlyData.length;
        const waveHeightMax = Math.max(...hourlyData.map(h => h.waveHeight));
        const waterTempAvg = hourlyData.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / hourlyData.length;
        const currentVelocityAvg = hourlyData.map(h => h.currentVelocity).reduce((a, b) => a + b, 0) / hourlyData.length;

        // Trasformiamo l'array orario nel formato atteso dal client Flutter
        const hourlyTransformed = hourlyData.map(h => ({
            time: h.time,
            tempC: h.temperature.toFixed(0),
            weatherCode: convertWmoToWwoCode(h.weatherCode), // Convertiamo il codice meteo
            weatherIconUrl: '', // Non più necessario, il client usa il weatherCode
            winddir16Point: degreesTo16PointDirection(h.windDirection) // Convertiamo i gradi
        }));

        return {
            ...day, // Mantiene astronomia e maree da WWO
            maxtempC: Math.max(...hourlyData.map(h => h.temperature)),
            mintempC: Math.min(...hourlyData.map(h => h.temperature)),
            dailyTempAvg: (Math.max(...hourlyData.map(h => h.temperature)) + Math.min(...hourlyData.map(h => h.temperature))) / 2,
            waveHeightMax,
            waterTempAvg,
            currentVelocityAvg,
            dailyPressure,
            dailyWindSpeedKph,
            avgCloudCover,
            dailyHumidity,
            hourly: hourlyTransformed, // Sovrascriviamo con i dati orari di OpenMeteo
        };
    });
}

// Stessa logica ma con dati da Stormglass
function combineStormglassData(stormglassAggregates, wwoData) {
     return wwoData.map(day => {
        const sgDay = stormglassAggregates[day.date];
        if (!sgDay) return null;

        const maxtempC = Math.max(...sgDay.airTemps.filter(t => t !== null));
        const mintempC = Math.min(...sgDay.airTemps.filter(t => t !== null));
        
        return {
            ...day, // Mantiene maree, astronomia e dati orari da WWO
            maxtempC,
            mintempC,
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

// Assembla il JSON finale per la UI
function assembleFinalForecast(unifiedForecastData) {
    let previousDayData = null;
    const finalForecast = [];

    for (const day of unifiedForecastData) {
        let trendPressione = '→';
        if (previousDayData?.dailyPressure) {
            if (day.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (day.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }

        const scoreData = calculatePescaScore({
            trendPressione,
            dailyWindSpeedKph: day.dailyWindSpeedKph,
            prevWindSpeed: previousDayData?.dailyWindSpeedKph,
            isNewOrFullMoon: day.isNewOrFullMoon,
            avgCloudCover: day.avgCloudCover,
            dailyPressure: day.dailyPressure,
            waveHeightMax: day.waveHeightMax,
            prevWaveHeightMax: previousDayData?.waveHeightMax,
            waterTempAvg: day.waterTempAvg,
            currentVelocityAvg: day.currentVelocityAvg,
            prevCurrentVelocityAvg: previousDayData?.currentVelocityAvg
        });

        const highTides = day.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = day.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        
        const { finestraMattino, finestraSera } = calcolaFinestrePesca(
            day.astronomy[0].sunrise,
            day.astronomy[0].sunset,
            highTides,
            lowTides,
            scoreData.displayScore
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

module.exports = { combineStandardData, combineStormglassData, assembleFinalForecast };