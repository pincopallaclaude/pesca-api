// /lib/utils/formatter.js
const { format, parseISO } = require('date-fns');
const { it } = require('date-fns/locale');

const capitalize = (s) => (s && s.charAt(0).toUpperCase() + s.slice(1)) || "";

function getSeaStateAcronym(height) {
    if (height === null || isNaN(height)) return '-';
    if (height < 0.1) return 'C'; if (height < 0.5) return 'QC';
    if (height < 1.25) return 'PM'; if (height < 2.5) return 'M';
    if (height < 4) return 'MM'; if (height < 6) return 'A';
    if (height < 9) return 'MA'; return 'G';
}

function formatTimeToHHMM(timeStr) {
    if (!timeStr) return 'N/D';
    if (!isNaN(timeStr) && !timeStr.includes(':')) {
        const paddedTime = timeStr.padStart(4, '0');
        return `${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}`;
    }
    if (timeStr.includes('AM') || timeStr.includes('PM')) {
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        if (modifier === 'PM' && hours !== '12') { hours = parseInt(hours, 10) + 12; }
        if (modifier === 'AM' && hours === '12') { hours = '00'; }
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }
    if (timeStr.includes(':')) {
        const parts = timeStr.split(':');
        return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
    }
    return 'N/D';
}

function getMeteoIconFromCode(code) {
    const codeNum = parseInt(code);
    if ([113].includes(codeNum)) return '☀️';
    if ([116, 119, 122].includes(codeNum)) return '☁️';
    if ([176, 263, 266, 293, 296, 299, 302, 305, 308, 353, 356, 359].includes(codeNum)) return '🌧️';
    if ([386, 389, 392, 395].includes(codeNum)) return '⛈️';
    if ([179, 182, 185, 323, 326, 329, 332, 335, 338, 368, 371].includes(codeNum)) return '❄️';
    return '🌤️';
}

// This function existed in forecast-logic but was missing here.
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

module.exports = {
    capitalize,
    getSeaStateAcronym,
    formatTimeToHHMM,
    getMeteoIconFromCode,
    getWeatherDescription, // Now exported
    format,
    parseISO,
    it
};