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
        
        // --- LOGICA DI ESTRAZIONE ROBUSTA ---
        let rawText = result.content[0].text;
        let finalAnalysis = rawText; // Default a Markdown
        
        try {
            // Tenta di parsare il testo come se fosse JSON
            const cleanedJsonText = rawText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(cleanedJsonText);
            
            // Se il parsing ha successo, cerca una chiave che contenga il nostro Markdown
            const analysisKey = Object.keys(parsed).find(k => typeof parsed[k] === 'string' && parsed[k].includes('### Analisi di Pesca'));
            
            if (analysisKey) {
                console.log(`[Proactive-AI] Rilevato output JSON. Estrazione dalla chiave: "${analysisKey}"`);
                finalAnalysis = parsed[analysisKey];
            } else if (parsed.markdown_analysis) {
                console.log(`[Proactive-AI] Rilevato output JSON. Estrazione dalla chiave "markdown_analysis"`);
                finalAnalysis = parsed.markdown_analysis;
            }
        } catch (e) {
            // Se il parsing fallisce, significa che è già Markdown. Ignora l'errore.
            console.log("[Proactive-AI] Rilevato output Markdown diretto. Nessuna estrazione necessaria.");
        }
        const timingMs = result.metadata?.timingMs || 'N/D';

        // 2. CACHING DEL RISULTATO
        if (finalAnalysis && finalAnalysis.trim().length > 50) {
            const cacheKey = `analysis-v2-${locationKey}`;
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