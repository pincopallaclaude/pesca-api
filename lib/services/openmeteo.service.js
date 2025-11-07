// /lib/services/openmeteo.service.js

import axios from 'axios';

async function fetchOpenMeteoData(lat, lon, forecastDays = 7) {
    console.log('[OpenMeteo Service] Fetching data from both forecast and marine endpoints...');

    // 1. Definisci i parametri per l'endpoint /forecast (dati atmosferici)
    const forecastParams = [
        'temperature_2m', 'relative_humidity_2m', 'pressure_msl', 
        'cloud_cover', 'windspeed_10m', 'winddirection_10m', 'weathercode'
    ].join(',');
    
    // 2. Definisci i parametri per l'endpoint /marine (dati marini)
    const marineParams = [
        'wave_height', 'sea_surface_temperature', 'ocean_current_velocity'
    ].join(',');

    // 3. Costruisci gli URL corretti per entrambi
    const forecastUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${forecastParams}&forecast_days=${forecastDays}`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${marineParams}&forecast_days=${forecastDays}`;
    
    // --- DEBUG LOG #1: Logghiamo gli URL che stiamo per chiamare ---
    console.log(`[DEBUG OM] Forecast URL: ${forecastUrl}`);
    console.log(`[DEBUG OM] Marine URL: ${marineUrl}`);
    
    // 4. Esegui le due chiamate in parallelo
    const [forecastResponse, marineResponse] = await Promise.all([
        axios.get(forecastUrl),
        axios.get(marineUrl)
    ]);
    
    const forecastApiData = forecastResponse.data.hourly;
    const marineApiData = marineResponse.data.hourly;
    
    // --- DEBUG LOG #2: Verifichiamo il numero di punti dati ricevuti ---
    console.log(`[DEBUG OM] Numero di ore ricevute da Forecast API: ${forecastApiData.time.length}`);
    console.log(`[DEBUG OM] Numero di ore ricevute da Marine API: ${marineApiData.time.length}`);
    // Esempio del primo timestamp per vedere la granularità
    console.log(`[DEBUG OM] Esempio timestamp (primo e secondo): ${forecastApiData.time[0]}, ${forecastApiData.time[1]}`);


    // 5. Unisci le due risposte in un unico array strutturato per giorno
    const dataByDay = {};
    for (let i = 0; i < forecastApiData.time.length; i++) {
        const date = forecastApiData.time[i].split('T')[0];
        const hour = forecastApiData.time[i].split('T')[1];

        if (!dataByDay[date]) { dataByDay[date] = []; }

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

    console.log('[OpenMeteo Service] Successfully fetched and merged data.');
    return dataByDay;
}

export { fetchOpenMeteoData };