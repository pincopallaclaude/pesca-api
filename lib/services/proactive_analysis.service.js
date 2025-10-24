// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import { mcpClient } from './mcp-client.service.js';
import { POSILLIPO_COORDS } from '../utils/constants.js';   // Import CORRETTO
import { areCoordsNear } from '../utils/geo.utils.js';    // Import per confronto ROBUSTO

/**
 * [PHANTOM Service] Esegue un'analisi RAG completa in background utilizzando il server MCP.
 * Non restituisce nulla, ma salva il risultato finale nella analysisCache.
 * @param {object} forecastData - L'oggetto completo della previsione, come generato da getUnifiedForecastData.
 * @param {string} locationKey - La chiave di localizzazione normalizzata (es. "40.813,14.209").
 */
async function runProactiveAnalysis(forecastData, locationKey) {
    // Logica di fallback intelligente per il nome della località
    let locationForTitle = 'località sconosciuta';
    const firstDayForecast = forecastData?.forecast?.[0];
    
    if (firstDayForecast?.location?.name) {
        locationForTitle = firstDayForecast.location.name;
    } else if (areCoordsNear(locationKey, POSILLIPO_COORDS)) { // CONFRONTO ROBUSTO
        locationForTitle = 'Zona Posillipo (Napoli)';
    } else {
        locationForTitle = locationKey; // Fallback finale sulle coordinate
    }

    console.log(`[Proactive-AI] Avvio analisi via MCP in background per ${locationForTitle}...`);

    try {
        
        if (!forecastData || !forecastData.forecast || forecastData.forecast.length === 0) {
            console.warn(`[Proactive-AI] Dati forecast vuoti per ${locationKey}. Analisi annullata.`);
            return;
        }

        // 1. CHIAMATA AL TOOL MCP
        // Deleghiamo tutta la logica di RAG (query vettoriale, costruzione prompt, chiamata a Gemini)
        // al nostro nuovo tool standardizzato.
        const result = await mcpClient.callTool('generate_analysis', {
            weatherData: firstDayForecast, // Passiamo solo i dati del primo giorno
            location: locationForTitle // Usa la variabile con fallback intelligente
        });
        
        if (result.isError || !result.content || result.content.length === 0) {
            const errorMessage = result.content?.[0]?.text || 'Errore sconosciuto dal tool MCP';
            throw new Error(errorMessage);
        }
        
        // La risposta del tool MCP è ora garantita (dal prompt) essere puro Markdown.
        // Non è più necessaria alcuna logica di parsing o conversione JSON.
        const finalAnalysis = result.content[0].text;
        
        // =================================================================
        // LOG DIAGNOSTICO: ISPEZIONA LA RISPOSTA GREZZA DELL'AI
        console.log("--- INIZIO RISPOSTA GREZZA AI (PROACTIVE) ---");
        console.log(finalAnalysis);
        console.log("--- FINE RISPOSTA GREZZA AI (PROACTIVE) ---");
        // =================================================================
        
        const timingMs = result.metadata?.timingMs || 'N/D';

        // 2. CACHING DEL RISULTATO
        if (finalAnalysis && finalAnalysis.trim().length > 50) {
            const cacheKey = `analysis-v2-${locationKey}`;
            // NOTA: La struttura della cache è stata semplificata. Ora cachiamo direttamente il Markdown.
            analysisCache.set(cacheKey, finalAnalysis.trim());
            console.log(`[Proactive-AI] ✅ Analisi per ${locationForTitle} generata e cachata con successo (${timingMs}ms).`);
        } else {
            console.warn(`[Proactive-AI] ⚠️ Analisi generata per ${locationForTitle} vuota o troppo corta. Non cachata.`);
        }

    } catch (error) {
        console.error(`[Proactive-AI] ❌ Errore durante l'analisi in background via MCP per ${locationKey}:`, error.message);
    }
}

export { runProactiveAnalysis };
