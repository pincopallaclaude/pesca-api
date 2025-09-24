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

module.exports = { convertWmoToWwoCode, degreesTo16PointDirection };