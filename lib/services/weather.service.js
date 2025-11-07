// /lib/services/weather.service.js

import axios from 'axios';

async function fetchOpenMeteoHourly(lat, lon) {
    console.time("PERF: fetchOpenMeteoHourly");
    const forecastParams = 'temperature_2m,relative_humidity_2m,pressure_msl,cloud_cover,windspeed_10m,winddirection_10m,weathercode,precipitation_probability,precipitation';
    const marineParams = 'wave_height,sea_surface_temperature';
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${forecastParams}&forecast_days=7`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineParams}&forecast_days=7`;
    const timeoutConfig = { timeout: 15000 };
    try {
        const [forecastResponse, marineResponse] = await Promise.all([
            axios.get(forecastUrl, timeoutConfig),
            axios.get(marineUrl, timeoutConfig)
        ]);
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
    } finally {
        console.timeEnd("PERF: fetchOpenMeteoHourly");
    }
}

async function fetchWwoDaily(lat, lon) {
    console.time("PERF: fetchWwoDaily");
    const url = `https://api.worldweatheronline.com/premium/v1/marine.ashx?key=${process.env.WORLDWEATHERONLINE_API_KEY}&q=${lat},${lon}&format=json&tide=yes&fx=yes&day=7`;
    try {
        const response = await axios.get(url, { timeout: 15000 });
        if (!response.data?.data?.weather) throw new Error("WWO API response structure is invalid.");
        return response.data.data.weather;
    } finally {
        console.timeEnd("PERF: fetchWwoDaily");
    }
}

/**
 * Esegue tutte le chiamate API in parallelo per recuperare i dati meteo grezzi.
 * @param {string} lat - Latitudine.
 * @param {string} lon - Longitudine.
 * @param {boolean} isPosillipo - Flag per decidere se chiamare l'API premium.
 * @returns {Promise<[Array, Object, Object|null]>} Una tupla con i dati grezzi da WWO, OpenMeteo e Stormglass.
 */
export async function fetchAllWeatherData(lat, lon, isPosillipo) {
    console.time("PERF: Promise.all(API_Calls)");
    const promises = [ fetchWwoDaily(lat, lon), fetchOpenMeteoHourly(lat, lon) ];

    if (isPosillipo) {
        // Importa dinamicamente solo quando serve per non creare dipendenze circolari
        const { fetchStormglassData } = await import('./stormglass.service.js');
        console.log(`--- [Weather Service] Location è Posillipo. Aggiungo fetch premium (Stormglass)... ---`);
        promises.push(fetchStormglassData(lat, lon).catch(err => {
            console.warn('[Weather Service] Stormglass fetch failed:', err.message);
            return null; // Non bloccare il flusso in caso di fallimento di Stormglass
        }));
    } else {
        console.log(`--- [Weather Service] Location NON è Posillipo (Stormglass NON richiesto). ---`);
        promises.push(Promise.resolve(null)); // Placeholder per mantenere la struttura dell'array
    }

    const results = await Promise.all(promises);
    console.timeEnd("PERF: Promise.all(API_Calls)");
    return results;
}