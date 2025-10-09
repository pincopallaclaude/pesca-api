// /lib/services/stormglass.service.js
const axios = require('axios');

async function fetchStormglassData(lat, lon) {
    console.log('[Stormglass Service] Fetching data...');
    // Requesting currentSpeed and currentDirection
    const params = 'currentSpeed,currentDirection'; 
    const url = `https://api.stormglass.io/v2/weather/point`;

    const response = await axios.get(url, {
        params: { lat, lng: lon, params },
        headers: { 'Authorization': process.env.STORMGLASS_API_KEY }
    });
    
    // [THE FIX] We now build the data structure that the rest of the system expects.
    const dataByDay = {};
    for (const hourData of response.data.hours) {
        const date = hourData.time.split('T')[0];
        if (!dataByDay[date]) {
            dataByDay[date] = []; // Initialize as an ARRAY
        }
        
        let speedInKn = 'N/D';
        let directionStr = 'N/D';
        
        if (hourData.currentSpeed?.sg != null) {
            let kn = hourData.currentSpeed.sg * 1.94384; // m/s to knots
            if (kn > 0 && kn < 0.1) kn = 0.1;
            speedInKn = kn.toFixed(1);
        }

        if (hourData.currentDirection?.sg != null) {
            directionStr = degreesTo16PointDirection(hourData.currentDirection.sg);
        }

        dataByDay[date].push({
            hour: hourData.time.split('T')[1].split(':')[0], // "08", "09", etc.
            currentSpeedKn: speedInKn,
            currentDirectionStr: directionStr,
        });
    }
    
    console.log(`[Stormglass Service] DEBUG: Data for first date key '${Object.keys(dataByDay)[0]}':`, dataByDay[Object.keys(dataByDay)[0]][8]);

    return dataByDay;
}


module.exports = { fetchStormglassData };