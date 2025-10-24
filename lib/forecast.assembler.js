// /lib/forecast.assembler.js

import { calculateHourlyPescaScore } from './domain/score.calculator';
import { findBestTimeWindow } from './domain/window.calculator';
import { convertWmoToWwoCode, degreesTo16PointDirection } from './utils/wmo_code_converter';
import { format, parseISO, it, capitalize, getMeteoIconFromCode, getSeaStateAcronym, formatTimeToHHMM } from './utils/formatter';

 
function getDailyWeatherIconCode(hourlyData) {
  if (!hourlyData || hourlyData.length === 0) {
    return '113'; // Fallback a 'Sereno' se non ci sono dati
  }

  const hourlyCodes = hourlyData.map(h => h.weatherCode);

  // Priorità degli eventi (codici WWO) - dal più "grave" al più "leggero"
  const priorityOrder = [
    '389', '386', // Temporale con/senza pioggia
    '395', '392', '371', '368', '338', '335', '332', '329', '326', '323', '230', '227', // Neve
    '359', '356', '353', '314', '311', '308', '305', '302', '299', '296', '293', '284', '281', // Pioggia
    '266', '263', '200', '176', // Pioggerella / Rischio pioggia
    '260', '248', '143', // Nebbia
    '122', '119', // Molto nuvoloso
    '116',       // Parzialmente nuvoloso
    '113',       // Sereno
  ];

  for (const code of priorityOrder) {
    if (hourlyCodes.includes(code)) {
      // Trovato l'evento più significativo, restituiscilo subito.
      return code;
    }
  }

  // Se nessuno dei codici prioritari è trovato (improbabile), ritorna il primo disponibile.
  return hourlyCodes[0];
}


function combineStandardData(wwoData, openMeteoDataByDay) {
    return wwoData.map(day => {
        const date = day.date;
        const hourlyData = openMeteoDataByDay[date] || [];
        if (hourlyData.length === 0) return { ...day, hourly: [] }; // Ritorna hourly vuoto se non ci sono dati

        const hourlyTransformed = hourlyData.map(h => ({
            time: h.time,
            tempC: h.temperature.toFixed(0),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            winddir16Point: degreesTo16PointDirection(h.windDirection),
            // Passa tutti i dati grezzi necessari per il calcolo
            windSpeed: h.windSpeed,
            cloudCover: h.cloudCover,
            waveHeight: h.waveHeight,
            waterTemperature: h.waterTemperature,
            currentVelocity: h.currentVelocity,
            pressure: h.pressure,
        }));

        return {
            ...day,
            maxtempC: Math.max(...hourlyData.map(h => h.temperature)),
            mintempC: Math.min(...hourlyData.map(h => h.temperature)),
            dailyTempAvg: hourlyData.map(h => h.temperature).reduce((a, b) => a + b, 0) / hourlyData.length,
            waveHeightMax: Math.max(...hourlyData.map(h => h.waveHeight)),
            waterTempAvg: hourlyData.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / hourlyData.length,
            currentVelocityAvg: hourlyData.map(h => h.currentVelocity).filter(v => v !== null).reduce((a, b) => a + b, 0) / (hourlyData.filter(h => h.currentVelocity !== null).length || 1),
            dailyPressure: hourlyData.map(h => h.pressure).reduce((a, b) => a + b, 0) / hourlyData.length,
            dailyWindSpeedKph: Math.max(...hourlyData.map(h => h.windSpeed)),
            avgCloudCover: hourlyData.map(h => h.cloudCover).reduce((a, b) => a + b, 0) / hourlyData.length,
            dailyHumidity: hourlyData.map(h => h.humidity).reduce((a, b) => a + b, 0) / hourlyData.length,
            hourly: hourlyTransformed,
        };
    });
}

function combineStormglassData(stormglassAggregates, wwoData, openMeteoDataByDay) {
     return wwoData.map(day => {
        const sgDay = stormglassAggregates[day.date];
        const hourlyOpenMeteo = openMeteoDataByDay[day.date] || [];
        if (!sgDay || hourlyOpenMeteo.length === 0) return { ...day, hourly: [] };
        
        const hourlyTransformed = hourlyOpenMeteo.map(h => ({
            time: h.time,
            tempC: h.temperature.toFixed(0),
            weatherCode: convertWmoToWwoCode(h.weatherCode),
            winddir16Point: degreesTo16PointDirection(h.windDirection),
            // Passa i dati grezzi per il calcolo
            windSpeed: h.windSpeed,
            cloudCover: h.cloudCover,
            waveHeight: h.waveHeight,
            waterTemperature: h.waterTemperature,
            currentVelocity: h.currentVelocity,
            pressure: h.pressure,
        }));
        
        // Sovrascriviamo le medie con i dati più precisi di Stormglass dove disponibili
        const waveHeightMax = Math.max(...sgDay.waveHeights.filter(wh => wh !== null));
        const waterTempAvg = sgDay.waterTemps.filter(wt => wt !== null).reduce((a, b) => a + b, 0) / (sgDay.waterTemps.filter(wt => wt !== null).length || 1);
        const currentVelocityAvg = sgDay.currentSpeeds.filter(cs => cs !== null).reduce((a, b) => a + b, 0) / (sgDay.currentSpeeds.filter(cs => cs !== null).length || 1);
        
        return {
            ...day,
            maxtempC: Math.max(...sgDay.airTemps.filter(t => t !== null)),
            mintempC: Math.min(...sgDay.airTemps.filter(t => t !== null)),
            dailyTempAvg: sgDay.airTemps.filter(t => t !== null).reduce((a, b) => a + b, 0) / (sgDay.airTemps.filter(t => t !== null).length || 1),
            dailyPressure: sgDay.pressures.filter(p => p !== null).reduce((a, b) => a + b, 0) / (sgDay.pressures.filter(p => p !== null).length || 1),
            dailyWindSpeedKph: Math.max(...sgDay.windSpeeds),
            avgCloudCover: sgDay.cloudCovers.filter(c => c !== null).reduce((a, b) => a + b, 0) / (sgDay.cloudCovers.filter(c => c !== null).length || 1),
            dailyHumidity: sgDay.humidities.filter(h => h !== null).reduce((a, b) => a + b, 0) / (sgDay.humidities.filter(h => h !== null).length || 1),
            waveHeightMax: waveHeightMax,
            waterTempAvg: waterTempAvg,
            currentVelocityAvg: currentVelocityAvg,
            hourly: hourlyTransformed, // Usa sempre i dati orari trasformati da OpenMeteo
        };
     }).filter(Boolean);
}

function processAndAssemble(unifiedForecastData) {
    let previousDayData = null;
    const finalForecast = [];

    for (const day of unifiedForecastData) {
        if (!day || !day.date || !day.hourly || day.hourly.length < 24) continue; 
        
        let trendPressione = '→';
        if (previousDayData?.dailyPressure && day.dailyPressure) {
            if (day.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (day.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }
        
        const hourlyScores = day.hourly.map(hourData => {
            const hour = parseInt(hourData.time.split(':')[0], 10);
            const score = calculateHourlyPescaScore({
                pressure: hourData.pressure, 
                trendPressione,
                windSpeedKph: hourData.windSpeed,
                isNewOrFullMoon: day.isNewOrFullMoon,
                cloudCover: hourData.cloudCover,
                waveHeight: hourData.waveHeight,
                waterTemp: hourData.waterTemperature,
                currentVelocity: hourData.currentVelocity,
            });
            return { hour, score: score.numericScore, displayScore: score.displayScore };
        });
        
        const morningWindow = findBestTimeWindow(hourlyScores, 4, 13);
        const eveningWindow = findBestTimeWindow(hourlyScores, 14, 22);
        
        const finestraMattino = { orario: morningWindow ?? 'Dati insuff.' };
        const finestraSera = { orario: eveningWindow ?? 'Dati insuff.' };
        
        const avgNumericScore = hourlyScores.reduce((sum, h) => sum + h.score, 0) / hourlyScores.length;
        
        finalForecast.push({
            giornoNome: capitalize(format(parseISO(day.date), 'eee', { locale: it })),
            giornoData: format(parseISO(day.date), 'dd/MM'),
            meteoIcon: getMeteoIconFromCode(getDailyWeatherIconCode(day.hourly)),
            moon_phase: day.astronomy[0].moon_phase,
            alba: `☀️ ${formatTimeToHHMM(day.astronomy[0].sunrise)}`,
            tramonto: formatTimeToHHMM(day.astronomy[0].sunset),
            maree: `Alta: ${day.tides[0].tide_data.filter(t => t.tide_type === 'HIGH').map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${day.tides[0].tide_data.filter(t => t.tide_type === 'LOW').map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaAvg: day.dailyTempAvg.toFixed(0),
            temperaturaMax: day.maxtempC,
            temperaturaMin: day.mintempC,
            pressione: day.dailyPressure.toFixed(0),
            umidita: day.dailyHumidity.toFixed(0),
            trendPressione,
            ventoDati: `${(day.dailyWindSpeedKph / 1.852).toFixed(0)} kn ${day.hourly.find(h => parseInt(h.time.split(':')[0]) >= new Date().getHours())?.winddir16Point ?? day.hourly[0].winddir16Point}`,
            pescaScoreData: {
                numericScore: avgNumericScore,
                displayScore: Math.min(5, Math.max(1, Math.round(avgNumericScore))),
                hourlyScores: hourlyScores.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score })),
            },
            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(day.waveHeightMax),
            temperaturaAcqua: day.waterTempAvg?.toFixed(0) ?? 'N/D',
            velocitaCorrente: day.currentVelocityAvg ? (day.currentVelocityAvg * 1.94384).toFixed(1) : 'N/D',
            hourly: day.hourly.map(h => ({...h, tempC: String(h.tempC) })),
        });
        
        previousDayData = day;
    }
    
    return finalForecast;
}

export { combineStandardData, combineStormglassData, processAndAssemble };