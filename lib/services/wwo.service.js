// /lib/services/wwo.service.js

import axios from 'axios';
import { formatTimeToHHMM } from '../utils/formatter';

async function fetchWwoData(lat, lon, forecastDays = 7) {
    console.log('[WWO Service] Fetching data...');
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=${forecastDays}`;
    const response = await axios.get(url);
    const weatherData = response.data.data.weather;
    if (!weatherData || weatherData.length === 0) {
        throw new Error("WWO API did not return data.");
    }

    // Trasformiamo i dati grezzi in un formato standard
    return weatherData.map(day => ({
        date: day.date,
        maxtempC: parseFloat(day.maxtempC),
        mintempC: parseFloat(day.mintempC),
        avgtempC: parseFloat(day.avgtempC),
        astronomy: day.astronomy,
        tides: day.tides,
        isNewOrFullMoon: day.astronomy[0].moon_phase.toLowerCase().includes('new moon') || day.astronomy[0].moon_phase.toLowerCase().includes('full moon'),
        hourly: day.hourly.map(h => ({
            time: formatTimeToHHMM(h.time),
            tempC: h.tempC,
            weatherCode: h.weatherCode,
            weatherIconUrl: h.weatherIconUrl?.[0]?.value ?? null,
            windspeedKmph: parseFloat(h.windspeedKmph),
            pressure: parseFloat(h.pressure),
            humidity: parseFloat(h.humidity),
            cloudcover: parseFloat(h.cloudcover),
            winddir16Point: h.winddir16Point,
            swellHeight_m: parseFloat(h.swellHeight_m),
        })),
    }));
}

export { fetchWwoData };