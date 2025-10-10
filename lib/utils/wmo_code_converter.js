// /lib/utils/wmo_code_converter.js

// Converte il weather code WMO di Open-Meteo in uno compatibile con la logica WWO
function convertWmoToWwoCode(wmoCode) {
    const code = Number(wmoCode);
    if (code === 0) return '113'; // Clear sky -> Sunny
    if (code === 1 || code === 2 || code === 3) return '116'; // Mainly clear, partly cloudy, and overcast -> Partly cloudy
    if (code === 45 || code === 48) return '260'; // Fog -> Fog
    if (code >= 51 && code <= 55) return '266'; // Drizzle -> Light drizzle
    if (code >= 56 && code <= 57) return '311'; // Freezing Drizzle -> Light freezing rain
    if (code >= 61 && code <= 65) return '296'; // Rain -> Light rain
    if (code >= 66 && code <= 67) return '314'; // Freezing Rain -> Moderate or heavy freezing rain
    if (code >= 71 && code <= 75) return '329'; // Snow fall -> Moderate snow
    if (code >= 80 && code <= 82) return '353'; // Rain showers -> Light rain shower
    if (code >= 95 && code <= 99) return '389'; // Thunderstorm -> Moderate or heavy rain with thunder
    return '119'; // Default to Cloudy
}

// Converte i gradi in una direzione testuale a 16 punti (es. 90 -> E)
function degreesTo16PointDirection(degrees) {
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return directions[Math.round((degrees / 22.5) % 16)];
}

// Utility for coordinate checking, moved from forecast-logic.js
function areCoordsNear(coords1, coords2, toleranceKm = 1) {
    const [lat1_str, lon1_str] = coords1.split(',');
    const [lat2_str, lon2_str] = coords2.split(',');
    const lat1 = parseFloat(lat1_str); const lon1 = parseFloat(lon1_str);
    const lat2 = parseFloat(lat2_str); const lon2 = parseFloat(lon2_str);
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 0.5 - Math.cos(dLat)/2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon))/2;
    const distance = R * 2 * Math.asin(Math.sqrt(a));
    console.log(`--- [areCoordsNear DEBUG] Distanza calcolata: ${distance.toFixed(3)} km. Tolleranza: ${toleranceKm} km. ---`);
    return distance < toleranceKm;
}

// Logical utility for status labeling, moved from forecast-logic.js
function getStatusLabel(value) {
    if (typeof value === 'string' && (value.trim().toUpperCase() === 'N/D' || value.trim() === '' || value.trim() === '→')) {
        return 'N/D';
    }
    if (typeof value === 'string' && (value.trim() === '↓' || value.trim() === '↑')) {
        return 'SI';
    }
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
        return 'NO';
    }
    return 'SI';
}

module.exports = { 
    convertWmoToWwoCode, 
    degreesTo16PointDirection,
    areCoordsNear,        // Now exported
    getStatusLabel        // Now exported
};