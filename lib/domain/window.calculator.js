// /lib/domain/window.calculator.js

import { formatTimeToHHMM } from '../utils/formatter';

function findBestTimeWindow(hourlyScores, startHour, endHour) {
    let bestScore = -1;
    let bestWindowStart = -1;
    
    // Filtra le ore per il periodo di riferimento (mattina/pomeriggio)
    const relevantHours = hourlyScores.filter(h => h.hour >= startHour && h.hour <= endHour);

    if (relevantHours.length < 2) return null; // Non ci sono abbastanza dati per una finestra di 2 ore

    // Scansiona le ore per trovare la coppia consecutiva con la media più alta
    for (let i = 0; i < relevantHours.length - 1; i++) {
        const currentHour = relevantHours[i];
        const nextHour = relevantHours[i + 1];

        // Controlla se le ore sono consecutive
        if (nextHour.hour === currentHour.hour + 1) {
            const avgScore = (currentHour.score + nextHour.score) / 2;
            if (avgScore > bestScore) {
                bestScore = avgScore;
                bestWindowStart = currentHour.hour;
            }
        }
    }
    
    if (bestWindowStart === -1) return null; // Nessuna finestra valida trovata
    
    // Formatta l'output
    const formatHour = (h) => `${String(h).padStart(2, '0')}:00`;
    // Nota: ho usato formatHour(bestWindowStart + 2) per mantenere la logica dell'output originale
    // che sembra voler rappresentare un intervallo di due ore (es. 08:00 - 10:00), 
    // anche se il calcolo si basa sulla media di due ore consecutive (bestWindowStart e bestWindowStart + 1).
    return `${formatHour(bestWindowStart)} - ${formatHour(bestWindowStart + 2)}`;
}

export { findBestTimeWindow };