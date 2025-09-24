// /lib/services/openmeteo.service.js
const axios = require('axios');

async function fetchOpenMeteoData(lat, lon, forecastDays = 7) {
    console.log('[OpenMeteo Service] Fetching data...');
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,sea_surface_temperature,ocean_current_velocity&forecast_days=${forecastDays}`;
    const response = await axios.get(url);
    
    // Trasformiamo i dati grezzi in un formato standard per giorno
    const marineData = response.data.hourly;
    const marineDataByDay = {};
    for (let i = 0; i < marineData.time.length; i++) {
        const date = marineData.time[i].split('T')[0];
        if (!marineDataByDay[date]) {
            marineDataByDay[date] = { wave_height: [], sea_surface_temperature: [], ocean_current_velocity: [] };
        }
        marineDataByDay[date].wave_height.push(marineData.wave_height[i]);
        marineDataByDay[date].sea_surface_temperature.push(marineData.sea_surface_temperature[i]);
        marineDataByDay[date].ocean_current_velocity.push(marineData.ocean_current_velocity[i]);
    }

    return marineDataByDay;
}

module.exports = { fetchOpenMeteoData };