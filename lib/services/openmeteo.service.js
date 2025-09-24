// /lib/services/openmeteo.service.js
const axios = require('axios');

async function fetchOpenMeteoData(lat, lon, forecastDays = 7) {
    console.log('[OpenMeteo Service] Fetching detailed marine hourly data...');
    // RIPRISTINIAMO LA CHIAMATA A /marine CON LA SINTASSI CORRETTA.
    console.log('[OpenMeteo Service] Fetching detailed hourly data from combined endpoints...');
    
    // Lista dei parametri per l'endpoint /forecast (che è il più completo)
    const hourlyParams = [
        'temperature_2m', 'relative_humidity_2m', 'pressure_msl', 'cloud_cover',
        'windspeed_10m', 'winddirection_10m', 'weathercode', 'wave_height',
        'sea_surface_temperature'
    ].join(',');

    // L'URL è costruito usando un oggetto URLSearchParams per garantire la codifica corretta
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.append('latitude', lat);
    url.searchParams.append('longitude', lon);
    url.searchParams.append('hourly', hourlyParams);
    url.searchParams.append('forecast_days', forecastDays);
    
    const response = await axios.get(url.toString());
    
    // Trasformiamo i dati grezzi in un formato standard per giorno
    const apiData = response.data.hourly;
    const dataByDay = {};

    for (let i = 0; i < apiData.time.length; i++) {
        const date = apiData.time[i].split('T')[0];
        const hour = apiData.time[i].split('T')[1];

        if (!dataByDay[date]) { dataByDay[date] = []; }

        dataByDay[date].push({
            time: hour,
            temperature: apiData.temperature_2m[i],
            humidity: apiData.relative_humidity_2m[i],
            pressure: apiData.pressure_msl[i],
            cloudCover: apiData.cloud_cover[i],
            windSpeed: apiData.windspeed_10m[i],
            windDirection: apiData.winddirection_10m[i],
            weatherCode: apiData.weathercode[i],
            waveHeight: apiData.wave_height[i],
            waterTemperature: apiData.sea_surface_temperature[i],
            // 'ocean_current_velocity' non è supportato da questo endpoint, quindi è null
            currentVelocity: null 
        });
    }

    return dataByDay;
}

module.exports = { fetchOpenMeteoData };