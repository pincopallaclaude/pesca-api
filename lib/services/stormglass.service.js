// /lib/services/stormglass.service.js
const axios = require('axios');

async function fetchStormglassData(lat, lon) {
    console.log('[Stormglass Service] Fetching data...');
    const params = [
        'waveHeight','waterTemperature','currentSpeed','windSpeed',
        'airTemperature','pressure','cloudCover','humidity'
    ].join(',');
    const url = `https://api.stormglass.io/v2/weather/point`;
    const response = await axios.get(url, {
        params: { lat, lng: lon, params },
        headers: { 'Authorization': process.env.STORMGLASS_API_KEY }
    });
    
    // Trasformiamo i dati grezzi in un formato standard per giorno
    const stormglassData = response.data;
    const dailyData = {};
    stormglassData.hours.forEach(hour => {
        const date = hour.time.split('T')[0];
        if (!dailyData[date]) {
            dailyData[date] = { waveHeights: [], waterTemps: [], currentSpeeds: [], windSpeeds: [], airTemps: [], pressures: [], cloudCovers: [], humidities: [] };
        }
        dailyData[date].waveHeights.push(hour.waveHeight?.sg ?? null);
        dailyData[date].waterTemps.push(hour.waterTemperature?.sg ?? null);
        dailyData[date].currentSpeeds.push(hour.currentSpeed?.sg ?? null);
        dailyData[date].windSpeeds.push((hour.windSpeed?.sg ?? 0) * 3.6);
        dailyData[date].airTemps.push(hour.airTemperature?.sg ?? null);
        dailyData[date].pressures.push(hour.pressure?.sg ?? null);
        dailyData[date].cloudCovers.push(hour.cloudCover?.sg ?? null);
        dailyData[date].humidities.push(hour.humidity?.sg ?? null);
    });

    return dailyData;
}

module.exports = { fetchStormglassData };