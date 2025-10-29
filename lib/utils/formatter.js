// /lib/utils/formatter.js
import { parse, format } from 'date-fns';

// Definiamo tutte le funzioni come costanti
const capitalize = (s) => {
    return s.charAt(0).toUpperCase() + s.slice(1);
};

const timeToHours = (timeStr) => {
    if (!timeStr) return 0;
    try {
        const [hours] = timeStr.replace(' AM', '').replace(' PM', '').split(':');
        return parseInt(hours, 10) + (timeStr.includes('PM') && hours !== '12' ? 12 : 0);
    } catch { return 0; }
};

const formatTimeToHHMM = (timeStr) => {
    if (!timeStr) return 'N/D';
    try {
        const parsed = parse(timeStr, 'h:mm a', new Date());
        return format(parsed, 'HH:mm');
    } catch { return timeStr; }
};

const getSeaStateAcronym = (waveHeight) => {
    if (waveHeight == null) return 'N/D';
    if (waveHeight < 0.1) return 'C';
    if (waveHeight < 0.5) return 'QC';
    if (waveHeight < 1.25) return 'PM';
    if (waveHeight < 2.5) return 'M';
    if (waveHeight < 4) return 'MM';
    if (waveHeight < 6) return 'A';
    return 'G';
};

const getSeaStateDescription = (waveHeight) => {
    if (waveHeight == null) return 'N/D';
    if (waveHeight < 0.1) return 'Calmo';
    if (waveHeight < 0.5) return 'Quasi Calmo';
    if (waveHeight < 1.25) return 'Poco Mosso';
    if (waveHeight < 2.5) return 'Mosso';
    if (waveHeight < 4) return 'Molto Mosso';
    if (waveHeight < 6) return 'Agitato';
    return 'Grosso';
};

const getMeteoIconFromCode = (wmoCode) => {
    if (wmoCode >= 95) return "🌩️";
    if (wmoCode >= 80) return "🌧️";
    if (wmoCode >= 71) return "❄️";
    if (wmoCode >= 51) return "🌦️";
    if (wmoCode >= 45) return "🌫️";
    if (wmoCode === 3) return "☁️";
    if (wmoCode >= 1) return "🌤️";
    return "☀️";
};

// Esportiamo tutto in un unico blocco alla fine
export {
    capitalize,
    timeToHours,
    formatTimeToHHMM,
    getSeaStateAcronym,
    getSeaStateDescription,
    getMeteoIconFromCode
};