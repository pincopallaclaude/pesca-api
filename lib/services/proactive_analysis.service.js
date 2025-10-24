// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import { mcpClient } from './mcp-client.service.js'; // NUOVO IMPORT

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background utilizzando il server MCP.
 * Non restituisce nulla, ma salva il risultato finale nella analysisCache.
 * @param {object} forecastData - L'oggetto completo della previsione, come generato da getUnifiedForecastData.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813,14.209").
 */
async function runProactiveAnalysis(forecastData, locationKey) {
    const locationName = forecastData?.forecast?.[0]?.locationName || locationKey;
    console.log(`[Proactive-AI] Avvio analisi via MCP in background per ${locationName}...`);

    try {
        if (!forecastData || !forecastData.forecast || forecastData.forecast.length === 0) {
            console.warn(`[Proactive-AI] Dati forecast vuoti per ${locationKey}. Analisi annullata.`);
            return;
        }

        // 1. CHIAMATA AL TOOL MCP
        // Deleghiamo tutta la logica di RAG (query vettoriale, costruzione prompt, chiamata a Gemini)
        // al nostro nuovo tool standardizzato.
        const result = await mcpClient.callTool('generate_analysis', {
            weatherData: forecastData.forecast[0], // Passiamo solo i dati del primo giorno
            location: locationName
        });
        
        if (result.isError || !result.content || result.content.length === 0) {
            const errorMessage = result.content?.[0]?.text || 'Errore sconosciuto dal tool MCP';
            throw new Error(errorMessage);
        }

        const finalAnalysis = result.content[0].text;
        const timingMs = result.metadata?.timingMs || 'N/D';

        // 2. CACHING DEL RISULTATO
        if (finalAnalysis && finalAnalysis.trim().length > 50) {
            const cacheKey = `analysis-v1-${locationKey}`;
            // NOTA: La struttura della cache è stata semplificata. Ora cachiamo direttamente il Markdown.
            // Il client si aspetterà questo. Se necessario, si può wrappare in { status: 'success', data: ... }
            analysisCache.set(cacheKey, finalAnalysis.trim());
            console.log(`[Proactive-AI] ✅ Analisi per ${locationName} generata e cachata con successo (${timingMs}ms).`);
        } else {
            console.warn(`[Proactive-AI] ⚠️ Analisi generata per ${locationName} vuota o troppo corta. Non cachata.`);
        }

    } catch (error) {
        console.error(`[Proactive-AI] ❌ Errore durante l'analisi in background via MCP per ${locationKey}:`, error.message);
    }
}

export { runProactiveAnalysis };