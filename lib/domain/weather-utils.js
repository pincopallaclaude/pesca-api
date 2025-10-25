// /lib/domain/weather-utils.js

/**
 * Analizza 24 codici meteo orari e restituisce il più significativo.
 */
export function getMostSignificantWeatherCode(hourlyWmoCodes) {
    const priorityOrder = [
        95, 96, 99, 71, 73, 75, 77, 85, 86, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82,
        3, 2, 1, 0
    ];
    for (const code of priorityOrder) {
        if (hourlyWmoCodes.includes(code)) {
            return code;
        }
    }
    return hourlyWmoCodes[12] || hourlyWmoCodes[0];
}

/**
 * Trova la migliore finestra temporale di 2 ore basata sui punteggi orari.
 */
export function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1;
    let bestWindowStart = -1;
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);
    
    if (relevantHours.length < 2) return null;

    for (let i = 0; i < relevantHours.length - 1; i++) {
        if (relevantHours[i + 1].hour !== relevantHours[i].hour + 1) continue;
        
        const avgScore = (relevantHours[i].score + relevantHours[i + 1].score) / 2;
        if (avgScore > bestScore) {
            bestScore = avgScore;
            bestWindowStart = relevantHours[i].hour;
        }
    }

    if (bestWindowStart === -1) return null;
    
    const formatTime = (h) => `${String(h).padStart(2, '0')}:00`;
    return `${formatTime(bestWindowStart)} - ${formatTime(bestWindowStart + 2)}`;
}