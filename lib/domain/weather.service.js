// lib/domain/weather.service.js

/**
 * Simula il recupero dei dati meteo-marini per una località e data specifica.
 * In una versione reale, questo chiamerebbe un'API esterna (es. OpenWeather, ecc.).
 * @param {string} location - Località di pesca (es. "Foce del Tevere").
 * @param {string} date - Data del giorno.
 * @returns {object} Un oggetto contenente i dati meteo-marini simulati.
 */
function getSimulatedWeather(location, date) {
    // Scegliamo un set di condizioni che attivano la nostra KB (mare in scaduta)
    const conditions = {
        location: location,
        date: date,
        pressure_trend: "in calo", // Attiva la regola della Spigola/Generale
        sea_condition: "in scaduta", // Attiva la regola della Spigola
        wind_speed: "10-15 nodi",
        wind_direction: "Nord-Ovest (Maestrale)",
        water_temp: "18°C",
        moon_phase: "Luna Calante",
        tide: "alta marea in crescita",
        visibility: "buona",
        notes: "Condizioni ottimali per i predatori costieri a causa del movimento dell'acqua."
    };

    // Formattiamo i dati in una stringa pulita per il prompt di Gemini
    const weatherString = `
        Località: ${conditions.location} (${conditions.date})
        Tendenza Pressione: ${conditions.pressure_trend}
        Condizione Mare: ${conditions.sea_condition}
        Vento: ${conditions.wind_speed} da ${conditions.wind_direction}
        Temperatura Acqua: ${conditions.water_temp}
        Fase Lunare: ${conditions.moon_phase}
        Marea: ${conditions.tide}
    `;

    // Restituiamo sia l'oggetto che la stringa formattata (la useremo per la KB e il prompt)
    return {
        data: conditions,
        formattedString: weatherString,
        // Usiamo una combinazione di termini per interrogare la KB
        kbQuery: `${conditions.sea_condition} ${conditions.pressure_trend} ${conditions.tide}`
    };
}

export { getSimulatedWeather };