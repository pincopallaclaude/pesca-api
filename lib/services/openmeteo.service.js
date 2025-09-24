// /lib/services/openmeteo.service.js
const axios = require('axios');

async function fetchOpenMeteoData(lat, lon, forecastDays = 7) {
    console.log('[OpenMeteo Service] Fetching detailed hourly data...');
    // Lista completa dei parametri orari che ci servono
    const hourlyParams = [
        'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
        'pressure_msl', 'cloud_cover', 'windspeed_10m', 'winddirection_10m',
        'wave_height', 'sea_surface_temperature', 'ocean_current_velocity'
    ].join(',');

    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${hourlyParams}&forecast_days=${forecastDays}`;
    const response = await axios.get(url);
    
    // Trasformiamo i dati grezzi in un formato standard per giorno
    const apiData = response.data.hourly;
    const dataByDay = {};

    for (let i = 0; i < apiData.time.length; i++) {
        const date = apiData.time[i].split('T')[0];
        const hour = apiData.time[i].split('T')[1];

        if (!dataByDay[date]) {
            dataByDay[date] = [];
        }

        // Creiamo un oggetto per ogni ora
        dataByDay[date].push({
            time: hour,
            temperature: apiData.temperature_2m[i],
            humidity: apiData.relative_humidity_2m[i],
            pressure: apiData.pressure_msl[i],
            cloudCover: apiData.cloud_cover[i],
            windSpeed: apiData.wind_speed_10m[i], // kph
            windDirection: apiData.wind_direction_10m[i],
            weatherCode: apiData.weathercode[i], // Corretto da weather_code a weathercode
            waveHeight: apiData.wave_height[i],
            waterTemperature: apiData.sea_surface_temperature[i],
            // 'ocean_current_velocity' non è disponibile in questo endpoint,
            // lo mettiamo a null per evitare errori
            currentVelocity: null 
        });
    }

    return dataByDay;
}

module.exports = { fetchOpenMeteoData };