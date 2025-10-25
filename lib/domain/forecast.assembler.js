// /lib/domain/forecast.assembler.js

import { format, parseISO } from 'date-fns';
import { it } from 'date-fns/locale/index.js';
import * as formatter from '../utils/formatter.js';
import * as converter from '../utils/wmo_code_converter.js';
import { calculateHourlyPescaScore } from './score.calculator.js';

function getMostSignificantWeatherCode(hourlyWmoCodes) {
    const priorityOrder = [
        95, 96, 99, 71, 73, 75, 77, 85, 86, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82,
        3, 2, 1, 0
    ];
    for (const code of priorityOrder) {
        if (hourlyWmoCodes.includes(code)) {
            return code;
        }
    }
    return hourlyWmoCodes[12] || hourlyWmoCodes[0];
}

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1;
    let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    if (relevantHours.length < 2) return null;
    for (let i = 0; i < relevantHours.length - 1; i++) {
        if (relevantHours[i + 1].hour !== relevantHours[i].hour + 1) continue;
        const avgScore = (relevantHours[i].score + relevantHours[i + 1].score) / 2;
        if (avgScore > bestScore) {
            bestScore = avgScore;
            bestWindowStart = relevantHours[i].hour;
        }
    }
    if (bestWindowStart === -1) return null;
    const formatTime = (h) => `${String(h).padStart(2, '0')}:00`;
    return `${formatTime(bestWindowStart)} - ${formatTime(bestWindowStart + 2)}`;
}

/**
 * Prende i dati grezzi dalle API e li assembla nel formato finale per il client.
 * @param {Array} wwoDailyData - Dati giornalieri da WorldWeatherOnline.
 * @param {Object} openMeteoHourlyData - Dati orari da OpenMeteo, raggruppati per giorno.
 * @param {Object|null} stormglassData - Dati orari da Stormglass, se disponibili.
 * @param {string} resolvedName - Il nome della località risolto dal geocoding.
 * @returns {Array} L'array 'finalForecast' pronto per essere inviato al client.
 */
export function assembleForecastData(wwoDailyData, openMeteoHourlyData, stormglassData, resolvedName) {
    let previousDayData = null;
    const finalForecast = [];
    let hasLoggedScoreParams = false;
    let dayIndex = 0;

    const getStormglassCurrent = (date, hour) => {
        const defaultData = { currentSpeedKn: 'N/D', currentDirectionStr: 'N/D' };
        if (!stormglassData || !stormglassData[date]) return defaultData;
        const hourStr = String(hour).padStart(2, '0');
        const sgHourData = stormglassData[date].find(sg_h => sg_h.hour === hourStr);
        return sgHourData ? { currentSpeedKn: sgHourData.currentSpeedKn, currentDirectionStr: sgHourData.currentDirectionStr } : defaultData;
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
        const moonPhaseString = wwoDay.astronomy[0].moon_phase;
        const isNewOrFullMoon = moonPhaseString.toLowerCase().includes('new moon') || moonPhaseString.toLowerCase().includes('full moon');

        const hourlyScoresData = omHourly.map(h => {
            const currentHour = parseInt(h.time.split(':')[0], 10);
            const { currentSpeedKn, currentDirectionStr } = getStormglassCurrent(date, currentHour);
            const isFirstDay = date === wwoDailyData[0].date;
            const isFirstHour = currentHour === parseInt(omHourly[0].time.split(':')[0], 10);
            const shouldLog = !hasLoggedScoreParams && isFirstDay && isFirstHour;
            if (shouldLog) hasLoggedScoreParams = true;

            const scoreData = calculateHourlyPescaScore({
                hour: currentHour, pressure: h.pressure, trendPressione, windSpeedKph: h.windSpeed,
                isNewOrFullMoon, moonPhase: moonPhaseString, cloudCover: h.cloudCover,
                waveHeight: h.waveHeight, waterTemp: h.waterTemperature,
                currentSpeedKn: currentSpeedKn, currentDirectionStr: currentDirectionStr
            }, shouldLog);
            return { hour: currentHour, score: scoreData.numericScore, reasons: scoreData.reasons, ...h, currentSpeedKn, currentDirectionStr };
        });

        const enrichedHourlyData = hourlyScoresData;
        const avgNumericScore = hourlyScoresData.reduce((sum, h) => sum + h.score, 0) / hourlyScoresData.length;
        const displayScore = Math.min(5, Math.max(1, Math.round(avgNumericScore)));
        const dailyAvgHumidity = Math.round(omHourly.map(h => h.humidity).reduce((a, b) => a + b, 0) / omHourly.length);
        const dailyAvgWindSpeedKph = omHourly.map(h => h.windSpeed).reduce((a, b) => a + b, 0) / omHourly.length;
        const dailyAvgPressure = Math.round(omHourly.map(h => h.pressure).reduce((a, b) => a + b, 0) / omHourly.length);
        const allHourlyWmoCodes = omHourly.map(h => h.weatherCode);
        const mostSignificantWmoCode = getMostSignificantWeatherCode(allHourlyWmoCodes);
        const dailyWeatherCode = converter.convertWmoToWwoCode(mostSignificantWmoCode);
        const representativeWindData = enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12];
        const dailyWindDirectionDegrees = representativeWindData.windDirection;

        const sunriseHour = formatter.timeToHours(wwoDay.astronomy[0].sunrise);
        const sunsetHour = formatter.timeToHours(wwoDay.astronomy[0].sunset);
        const highTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'HIGH');
        const lowTides = wwoDay.tides[0].tide_data.filter(t => t.tide_type === 'LOW');
        const allTides = [...highTides.map(t => ({ ...t, type: 'Alta', tideTime: t.tideTime })), ...lowTides.map(t => ({ ...t, type: 'Bassa', tideTime: t.tideTime }))];

        const findClosestTide = (hour, tides) => {
            if (!tides || tides.length === 0) return { type: 'N/A', tideTime: '' };
            return tides.reduce((prev, curr) => {
                const prevDiff = Math.abs(formatter.timeToHours(prev.tideTime) - hour);
                const currDiff = Math.abs(formatter.timeToHours(curr.tideTime) - hour);
                return currDiff < prevDiff ? curr : prev;
            });
        };

        const hourlyClientFormat = enrichedHourlyData.map(h => {
            const currentHour = h.hour;
            const closestTide = findClosestTide(currentHour, allTides);
            return {
                time: h.time, isDay: currentHour >= sunriseHour && currentHour < sunsetHour,
                weatherCode: converter.convertWmoToWwoCode(h.weatherCode),
                tempC: h.temperature, windSpeedKn: Math.round(h.windSpeed / 1.852),
                windDirectionDegrees: h.windDirection, pressure: h.pressure, humidity: h.humidity,
                waveHeight: h.waveHeight, waterTemperature: h.waterTemperature,
                currentSpeedKn: h.currentSpeedKn, currentDirectionStr: h.currentDirectionStr,
                precipitationProbability: h.precipitationProbability, precipitation: h.precipitation,
                tide: `${closestTide.type} ${formatter.formatTimeToHHMM(closestTide.tideTime)}`,
            };
        });

        const isToday = (dayIndex === 0);
        const liveHourData = isToday
            ? (enrichedHourlyData.find(h => h.hour >= new Date().getHours()) ?? enrichedHourlyData[0])
            : (enrichedHourlyData.find(h => h.time.startsWith('14:')) ?? enrichedHourlyData[12]);

        const temperaturaAcqua = String(Math.round(omHourly.map(h => h.waterTemperature).reduce((a, b) => a + b, 0) / omHourly.length));
        const { currentSpeedKn, currentDirectionStr } = liveHourData || {};
        const currentDataString = (currentSpeedKn && currentDirectionStr && currentSpeedKn !== 'N/D')
            ? `${parseFloat(currentSpeedKn).toFixed(1)} kn ${currentDirectionStr}`
            : 'N/D';

        finalForecast.push({
            location: { name: resolvedName }, // Aggiunto il nome della località risolto
            giornoNome: formatter.capitalize(format(parseISO(date), 'eee', { locale: it })),
            giornoData: format(parseISO(date), 'dd/MM'),
            meteoIcon: formatter.getMeteoIconFromCode(liveHourData.weatherCode),
            weatherDesc: converter.getWeatherDescription(dailyWeatherCode),
            temperaturaAvg: String(Math.round(omHourly.map(h => h.temperature).reduce((a, b) => a + b, 0) / omHourly.length)),
            pressione: String(Math.round(dailyAvgPressure)),
            umidita: String(dailyAvgHumidity),
            ventoDati: `${(Math.max(...omHourly.map(h => h.windSpeed)) / 1.852).toFixed(0)} kn ${converter.degreesTo16PointDirection(representativeWindData.windDirection)}`,
            mare: `${formatter.getSeaStateAcronym(liveHourData.waveHeight)} ${temperaturaAcqua}° ${currentDataString}`,
            maree: `Alta: ${highTides.map(t => formatter.formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatter.formatTimeToHHMM(t.tideTime)).join(', ')}`,
            finestraMattino: { orario: findBestTimeWindow(hourlyScoresData, 4, 13) ?? "N/D" },
            finestraSera: { orario: findBestTimeWindow(hourlyScoresData, 14, 22) ?? "N/D" },
            pescaScoreData: {
                numericScore: avgNumericScore,
                displayScore: displayScore,
                hourlyScores: hourlyScoresData.map(h => ({ time: `${String(h.hour).padStart(2, '0')}:00`, score: h.score, reasons: h.reasons })),
            },
            temperaturaMax: Math.max(...omHourly.map(h => h.temperature)),
            temperaturaMin: Math.min(...omHourly.map(h => h.temperature)),
            trendPressione: trendPressione, dailyWeatherCode, dailyHumidity: dailyAvgHumidity,
            dailyPressure, dailyWindSpeedKn: dailyAvgWindSpeedKph / 1.852, dailyWindDirectionDegrees,
            sunriseTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunrise),
            sunsetTime: formatter.formatTimeToHHMM(wwoDay.astronomy[0].sunset),
            moonPhase: moonPhaseString,
            hourly: hourlyClientFormat
        });
        previousDayData = { dailyPressure };
        dayIndex++;
    }

    return finalForecast;
}