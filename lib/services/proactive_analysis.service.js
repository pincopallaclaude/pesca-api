// /lib/services/proactive_analysis.service.js
const { generateAnalysis } = require('./gemini.service.js');
const { queryKnowledgeBase } = require('./vector.service.js');
const { analysisCache } = require('../utils/cache.manager.js');

/**
 * Esegue l'intero flusso RAG in background e salva il risultato nella cache.
 * Progettato per essere chiamato senza 'await' (fire-and-forget).
 * @param {object} fullForecastData - L'oggetto completo restituito da fetchAndProcessForecast.
 * @param {string} locationCoords - Le coordinate normalizzate (es. "40.813,14.209").
 */
async function generateAndCacheAnalysis(fullForecastData, locationCoords) {
    try {
        console.log(`[Proactive AI] Avvio analisi in background per ${locationCoords}`);
        const firstDay = fullForecastData.forecast?.[0];
        if (!firstDay) return;

        // 1. Costruisci la query per il Vector DB (logica estratta da server.js)
        const weatherQuery = `Condizioni generali: ${firstDay.weatherDesc}. Stato del mare: ${firstDay.mare}. Pressione: ${firstDay.pressione}. Vento: ${firstDay.ventoDati}.`.trim().replace(/\s+/g, ' ');

        // 2. Esegui la ricerca semantica
        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        const knowledgeText = relevantDocs.length > 0
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n')
            : "Nessun fatto specifico trovato...";

        // 3. Costruisci il prompt (logica estratta da server.js)
        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.tempMinMax || 'N/A'}
            - Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
            - Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${(firstDay.currentHourData && firstDay.currentHourData.waterTemperature) || 'N/A'}C
            - Luna: ${firstDay.moonPhase || 'N/A'}, Maree: Alta ${firstDay.altaMarea || 'N/A'}, Bassa ${firstDay.bassaMarea || 'N/A'}
        `.trim();
        const prompt = `
            Sei Meteo Pesca AI, un esperto di pesca sportiva. Analizza i dati e i fatti pertinenti per dare un consiglio strategico in Italiano.

            --- ISTRUZIONI DI FORMATTAZIONE OBBLIGATORIE ---
            La tua risposta DEVE essere solo ed esclusivamente il testo dell'analisi, formattato in Markdown.
            - Usa '###' per i titoli.
            - Usa '*' per le liste puntate.
            - Evidenzia i concetti positivi con '**'.
            - Evidenzia gli avvertimenti con '~~'.
            - NON includere JSON, preamboli o altre spiegazioni al di fuori dell'analisi.

            --- DATI METEO-MARINI ---
            ${weatherTextForPrompt}
            --- FINE DATI ---

            --- FATTI RILEVANTI DALLA KNOWLEDGE BASE ---
            ${knowledgeText}
            --- FINE FATTI ---

            DOMANDA DELL'UTENTE: "${finalUserQuery}"

            Adesso, basandoti su tutto, genera l'analisi in Markdown.
        `.trim();

        // 4. Chiama Gemini
        const rawAiResponse = await generateAnalysis(prompt);

        // 5. Estrai il Markdown pulito (logica estratta da server.js)
        const cleanedJsonText = rawAiResponse.replace(/```json\s*/g, '').replace(/\s*```/g, '').trim();
        const parsedJson = JSON.parse(cleanedJsonText);
        const finalAnalysis = parsedJson.analysis || rawAiResponse;

        // 6. Salva il risultato nella cache dedicata
        const cacheKey = `analysis-${locationCoords}`;
        analysisCache.set(cacheKey, finalAnalysis);
        console.log(`[Proactive AI] Analisi per ${locationCoords} salvata in cache con successo.`);

    } catch (error) {
        console.error(`[Proactive AI] Errore durante l'analisi in background per ${locationCoords}:`, error.message);
    }
}

module.exports = { generateAndCacheAnalysis };