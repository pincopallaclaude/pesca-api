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

/**
 * Converte un codice meteo (WWO standard) in una stringa descrittiva.
 * @param {string|number} wwoCode - Il codice WWO da convertire.
 * @returns {string} - Descrizione testuale.
 */
function getWeatherDescription(wwoCode) {
    const code = Number(wwoCode);
    if (code === 113) return 'Cielo sereno (soleggiato)';
    if ([116, 119].includes(code)) return 'Parzialmente nuvoloso';
    if (code === 122) return 'Molto nuvoloso';
    if ([176, 263, 266, 293, 296].includes(code)) return 'Pioggerella leggera o pioggia debole';
    if ([299, 302, 305, 308, 353, 356, 359].includes(code)) return 'Pioggia moderata/forte';
    if ([386, 389, 392, 395].includes(code)) return 'Temporale o pioggia con fulmini';
    if ([143, 248, 260].includes(code)) return 'Nebbia';
    if ([179, 182, 185, 323, 326, 329, 332, 335, 338, 368, 371].includes(code)) return 'Neve o grandine';
    return 'Non specificato';
}

export { 
    convertWmoToWwoCode, 
    degreesTo16PointDirection,
    getWeatherDescription
};