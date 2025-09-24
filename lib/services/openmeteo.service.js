// /lib/services/openmeteo.service.js
const axios = require('axios');

async function fetchOpenMeteoData(lat, lon, forecastDays = 7) {
    console.log('[OpenMeteo Service] Fetching detailed marine hourly data...');
    // RIPRISTINIAMO LA CHIAMATA A /marine CON LA SINTASSI CORRETTA.
    const hourlyParams = [
        'wave_height',
        'sea_surface_temperature',
        'ocean_current_velocity'
    ].join(',');

    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&forecast_days=${forecastDays}`;
    
    // Ora aggiungiamo anche la chiamata al forecast per gli altri dati
    const forecastParams = [
        'temperature_2m', 'relative_humidity_2m', 'pressure_msl',
        'cloud_cover', 'windspeed_10m', 'winddirection_10m',
        'weathercode'
    ].join(',');
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${forecastParams}&forecast_days=${forecastDays}`;
    
    const [marineResponse, forecastResponse] = await Promise.all([
        axios.get(url),
        axios.get(forecastUrl)
    ]);
    
    // Trasformiamo e uniamo i dati
    const marineApiData = marineResponse.data.hourly;
    const forecastApiData = forecastResponse.data.hourly;
    const dataByDay = {};

    for (let i = 0; i < forecastApiData.time.length; i++) {
        const date = forecastApiData.time[i].split('T')[0];
        const hour = forecastApiData.time[i].split('T')[1];

        if (!dataByDay[date]) {
            dataByDay[date] = [];
        }

        dataByDay[date].push({
            time: hour,
            temperature: forecastApiData.temperature_2m[i],
            humidity: forecastApiData.relative_humidity_2m[i],
            pressure: forecastApiData.pressure_msl[i],
            cloudCover: forecastApiData.cloud_cover[i],
            windSpeed: forecastApiData.windspeed_10m[i],
            windDirection: forecastApiData.winddirection_10m[i],
            weatherCode: forecastApiData.weathercode[i],
            waveHeight: marineApiData.wave_height[i],
            waterTemperature: marineApiData.sea_surface_temperature[i],
            currentVelocity: marineApiData.ocean_current_velocity ? marineApiData.ocean_current_velocity[i] : null
        });
    }

    return dataByDay;
}

module.exports = { fetchOpenMeteoData };