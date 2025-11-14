// /lib/utils/formatter.js

import { format, parseISO } from 'date-fns';
import itPkg from 'date-fns/locale/it/index.js'; // Importa il default export (il pacchetto CJS)
const it = itPkg; // Assegna il pacchetto CJS all'oggetto 'it'

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
        const paddedTime = String(timeStr).padStart(4, '0');
        return `${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}`;
    }
    if (typeof timeStr === 'string' && (timeStr.includes('AM') || timeStr.includes('PM'))) {
        const [time, modifier] = timeStr.split(' ');
        let [hours, minutes] = time.split(':');
        
        // Parsing hours based on AM/PM modifier
        let hoursInt = parseInt(hours, 10);
        if (modifier === 'PM' && hoursInt !== 12) { hoursInt += 12; }
        if (modifier === 'AM' && hoursInt === 12) { hoursInt = 0; } // Midnight case

        return `${String(hoursInt).padStart(2, '0')}:${minutes}`;
    }
    if (typeof timeStr === 'string' && timeStr.includes(':')) {
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


/**
 * Utility per il logging di debug. Restituisce SI/NO/N/D per un valore.
 * @param {*} value - Il valore da controllare.
 * @returns {string}
 */
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


/**
 * Helper to convert a time string (e.g., "7:30 AM" or "19:30") into a numeric hour.
 * @param {string} timeStr - The time string.
 * @returns {number} - The hour as a number (0-23).
 */
function timeToHours(timeStr) {
    if(!timeStr) return 0;
    const parts = String(timeStr).match(/(\d+):(\d+)\s*(AM|PM)?/);
    if (!parts) return 0;
    let hours = parseInt(parts[1], 10);
    // Gestisce AM/PM
    if (parts[3] === 'PM' && hours !== 12) hours += 12;
    if (parts[3] === 'AM' && hours === 12) hours = 0; // Caso mezzanotte
    return hours;
};

// CORREZIONE APPLICATA QUI: Esportiamo formatTimeToHHMM come formatTime
export {
    capitalize,
    getSeaStateAcronym,
    formatTimeToHHMM as formatTime, // Ora formatTime è disponibile per l'import
    getMeteoIconFromCode,
    getStatusLabel,
    timeToHours,
    format,
    parseISO,
    it
};