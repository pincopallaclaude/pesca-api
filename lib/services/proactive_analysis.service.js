// /lib/services/proactive_analysis.service.js

const { generateAnalysis } = require('./gemini.service.js');
const { queryKnowledgeBase } = require('./vector.service.js');
const { analysisCache } = require('../utils/cache.manager.js');

const NOT_SPECIFIED = 'Informazione non disponibile';

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background.
 * Non restituisce nulla, ma salva il risultato finale nella analysisCache.
 * @param {object} forecastData - L'oggetto completo della previsione, come generato da getUnifiedForecastData.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813,14.209").
 */
async function runProactiveAnalysis(forecastData, locationKey) {
    console.log(`[Proactive-AI] Avvio analisi in background per ${locationKey}...`);
    try {
        const forecastDays = forecastData.forecast || [];
        if (forecastDays.length === 0) {
            console.warn(`[Proactive-AI] Dati forecast vuoti per ${locationKey}. Analisi annullata.`);
            return;
        }

        const firstDay = forecastDays[0];
        /*
        // --- 1. Logica di trigger (può essere espansa) ---
        const avgScore = firstDay.pescaScoreData?.numericScore || 0;
        if (avgScore < 4 && avgScore > 6) { // Esempio: esegui solo per score non mediocri
            console.log(`[Proactive-AI] Score (${avgScore.toFixed(1)}) non significativo. Analisi non necessaria.`);
            return;
        }*/

        // --- 2. Costruzione della query per il Vector DB ---
        const weatherDesc = firstDay.weatherDesc || NOT_SPECIFIED;
        const mare = firstDay.mare || NOT_SPECIFIED;
        const pressione = firstDay.pressione || NOT_SPECIFIED;
        const ventoDati = firstDay.ventoDati || NOT_SPECIFIED;

        const weatherQuery = `Condizioni generali: ${weatherDesc}. Stato del mare: ${mare}. Pressione: ${pressione}. Vento: ${ventoDati}.`.trim().replace(/\s+/g, ' ');
        
        // --- 3. Query RAG ---
        const relevantDocs = await queryKnowledgeBase(weatherQuery, 2);
        const knowledgeText = relevantDocs.length > 0 
            ? relevantDocs.map((doc, i) => `[Fatto Rilevante ${i + 1}]\n${doc}`).join('\n---\n') 
            : "Nessun fatto specifico trovato...";

        // --- 4. Debugging and Prompt Building
        console.log(`\n--- [DEBUG-RAG] Output Database Vettoriale (${relevantDocs.length} Docs) ---`);
        console.log(knowledgeText);
        console.log('----------------------------------------------------');

        // --- 5. Costruzione del Prompt (identica all'originale) ---
        const waterTemp = (firstDay.hourly && firstDay.hourly[0] && firstDay.hourly[0].waterTemperature !== undefined) 
            ? `${firstDay.hourly[0].waterTemperature}°C`
            : 'N/A';
        
        const weatherTextForPrompt = `
            Dati Meteo-Marini per ${firstDay.locationName || 'località sconosciuta'} (${firstDay.giornoData || 'oggi'}):
            - Condizioni: ${firstDay.weatherDesc || 'N/A'}, Temp: ${firstDay.temperaturaMin}°-${firstDay.temperaturaMax}°C
            - Vento: ${firstDay.ventoDati || 'N/A'}, Mare: ${firstDay.mare || 'N/A'}
            - Pressione: ${firstDay.pressione || 'N/A'}, Acqua: ${waterTemp}
            - Luna: ${firstDay.moonPhase || 'N/A'}, Maree: ${firstDay.maree || 'N/A'}
        `.trim().replace(/^\s+/gm, '');

        const prompt = `
            Sei Meteo Pesca AI... 
            --- ISTRUZIONI DI FORMATTAZIONE OBBLIGATORIE ---
            ...
            --- DATI METEO-MARINI ---
            ${weatherTextForPrompt}
            --- FINE DATI ---
            --- FATTI RILEVANTI DALLA KNOWLEDGE BASE ---
            ${knowledgeText}
            --- FINE FATTI ---
            DOMANDA DELL'UTENTE: "Qual è il miglior momento per pescare oggi?"
            Adesso, basandoti su tutto, genera l'analisi in Markdown.
        `.trim();

        // PUNTO 2: Stampa il prompt
        console.log('\n--- [DEBUG-PROMPT] Prompt Inviato all\'AI ---\n', prompt);

        // --- 6. Chiamata a Gemini ed Estrazione ---
        const rawAiResponse = await generateAnalysis(prompt);

        // PUNTO 3: Stampa la risposta grezza
        console.log('\n--- [DEBUG-RESPONSE] Risposta Grezza AI ---\n', rawAiResponse);

        let finalAnalysis;
        try {
            // Usa la stessa logica robusta dell'endpoint di fallback
            const cleanedJsonText = rawAiResponse.replace(/^```json\s*/, '').replace(/```$/, '').trim();
            const parsedJson = JSON.parse(cleanedJsonText);
            if (parsedJson && (parsedJson.analysis || parsedJson.analisi_markdown)) {
                finalAnalysis = parsedJson.analysis || parsedJson.analisi_markdown;
                console.log('[Proactive-AI] Estrazione da JSON riuscita.');
            } else {
                finalAnalysis = rawAiResponse;
                console.log('[Proactive-AI] Chiave "analysis" o "analisi_markdown" non trovata. Uso fallback.');
            }
        } catch (e) {
            // Se il parsing JSON fallisce, significa che l'IA ha (correttamente) inviato solo Markdown.
            finalAnalysis = rawAiResponse;
            console.log('[Proactive-AI] Parsing JSON fallito, assumo Markdown grezzo.');
        }

        // --- 7. Caching del risultato ---
        if (finalAnalysis && finalAnalysis.trim().length > 50) {
            const cacheKey = `analysis-v1-${locationKey}`;
            analysisCache.set(cacheKey, { analysis: finalAnalysis.trim() });
            console.log(`[Proactive-AI] ✅ Analisi per ${locationKey} generata e cachata con successo.`);
        } else {
             console.warn(`[Proactive-AI] ⚠️ Analisi generata per ${locationKey} vuota o troppo corta. Non cachata.`);
        }

    } catch (error) {
        console.error(`[Proactive-AI] ❌ Errore durante l'analisi in background per ${locationKey}:`, error.message);
    }
}

module.exports = { runProactiveAnalysis };