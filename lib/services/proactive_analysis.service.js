// /lib/services/proactive_analysis.service.js (Nuovo File)

const { generateAnalysis } = require('./gemini.service.js');
const { queryKnowledgeBase } = require('./vector.service.js');
const { analysisCache } = require('../utils/cache.manager.js');

/**
 * [P.H.A.N.T.O.M. - FASE 1]
 * Esegue l'analisi RAG completa in background, senza bloccare il flusso principale.
 * Il risultato viene salvato direttamente nella cache dedicata.
 * @param {object} fullForecastData - L'oggetto completo delle previsioni, come generato da fetchAndProcessForecast.
 * @param {string} locationCoords - Le coordinate "lat,lon" usate come parte della chiave cache.
 */
async function triggerProactiveAnalysis(fullForecastData, locationCoords) {
    console.log(`[Proactive-AI] Innesco analisi in background per ${locationCoords}...`);
    try {
        const cacheKey = `${parseFloat(locationCoords.split(',')[0]).toFixed(3)},${parseFloat(locationCoords.split(',')[1]).toFixed(3)}`;
        
        // Estrae i dati del primo giorno per costruire il prompt
        const firstDay = fullForecastData.forecast[0];
        if (!firstDay || Object.keys(firstDay).length === 0) {
            console.error('[Proactive-AI] Dati del primo giorno non validi. Analisi annullata.');
            return;
        }
        
        // --- Logica di costruzione del prompt (identica a quella in server.js) ---
        const NOT_SPECIFIED = 'N/A';
        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;

        const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');
        
        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        const knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato...";

        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${weatherDesc}, Temp: ${firstDay.tempMinMax || NOT_SPECIFIED}
            - Vento: ${ventoDati}, Mare: ${mare}
            - Pressione: ${pressione}, Acqua: ${(firstDay.currentHourData && firstDay.currentHourData.waterTemperature) || NOT_SPECIFIED}C
            - Luna: ${firstDay.moonPhase || NOT_SPECIFIED}, Maree: Alta ${firstDay.altaMarea || NOT_SPECIFIED}, Bassa ${firstDay.bassaMarea || NOT_SPECIFIED}
        `.trim();
        
        const prompt = `
            Sei Meteo Pesca AI... 
            ${weatherTextForPrompt}
            ...
            ${knowledgeText}
            ...
            Adesso, basandoti su tutto, genera l'analisi in Markdown.
        `.trim(); // NOTA: prompt abbreviato per brevità, usa il tuo prompt completo.

        // Chiamata all'AI
        const rawAiResponse = await generateAnalysis(prompt);

        // Estrazione del risultato (identica a quella in server.js)
        let finalAnalysis = '';
        const cleanedJsonText = rawAiResponse.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
        const parsedJson = JSON.parse(cleanedJsonText);
        if (parsedJson && parsedJson.analysis) {
            finalAnalysis = parsedJson.analysis.trim();
        } else {
            throw new Error("Campo 'analysis' non trovato nel JSON dell'AI.");
        }

        if (finalAnalysis.length > 50) {
            // Salvataggio nella cache dedicata
            analysisCache.set(cacheKey, finalAnalysis);
            console.log(`[Proactive-AI] ✅ Analisi per ${cacheKey} generata e salvata in cache con successo.`);
        } else {
            console.warn('[Proactive-AI] Analisi generata troppo corta. Non salvata in cache.');
        }

    } catch (error) {
        console.error(`[Proactive-AI] ERRORE durante l'analisi in background per ${locationCoords}:`, error.message);
    }
}

module.exports = { triggerProactiveAnalysis };