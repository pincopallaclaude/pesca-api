// /lib/services/proactive_analysis.service.js

import { analysisCache } from '../utils/cache.manager.js';
import { mcpClient } from './mcp-client.service.js';

/**
 * Converte l'oggetto JSON complesso dell'AI in una stringa Markdown formattata.
 * Questa funzione è identica a quella usata nel fallback per garantire uniformità.
 * @param {object} aiJson - L'oggetto JSON parsato dalla risposta dell'AI.
 * @returns {string | null} Una stringa Markdown o null se la struttura non è corretta.
 */
function convertComplexJsonToMarkdown(aiJson) {
    if (!aiJson || !aiJson.analisiPesca) return null;

    const { analisiPesca } = aiJson;
    const { titolo, valutazioneGenerale, specieTargetConsigliate, tecnicheConsigliate, escheAttrezzatura } = analisiPesca;

    // Inizia il Markdown con il titolo
    let markdown = `### ${titolo || 'Analisi di Pesca'}\n\n`;

    // Valutazione Generale
    if (valutazioneGenerale) {
        markdown += `**Valutazione Generale:** ${valutazioneGenerale.descrizione} (Punteggio: ${valutazioneGenerale.punteggioMedioGiornaliero})\n\n`;
    }

    // Specie Target
    if (specieTargetConsigliate && specieTargetConsigliate.length > 0) {
        markdown += "**Specie Target Consigliate:**\n";
        specieTargetConsigliate.forEach(specie => {
            markdown += `* **${specie.nome}:** ${specie.motivo}\n`;
        });
        markdown += "\n";
    }

    // Tecniche Consigliate
    if (tecnicheConsigliate && tecnicheConsigliate.length > 0) {
        markdown += "**Tecniche Consigliate:**\n";
        tecnicheConsigliate.forEach(tech => {
            markdown += `* **${tech.nome}:** ${tech.descrizione}\n`;
        });
        markdown += "\n";
    }
    
    // Esche/Attrezzatura
    if (escheAttrezzatura) {
        markdown += `**Esche e Attrezzatura:** ${escheAttrezzatura.descrizione}\n`;
    }

    return markdown.trim();
}


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
        
        // --- LOGICA DI ESTRAZIONE ROBUSTA (AGGIORNATA) ---
        let rawText = result.content[0].text;
        let finalAnalysis = rawText; // Default: assumiamo sia già Markdown

        try {
            // Rimuovi eventuali blocchi di codice markdown (es. ```json ... ```)
            const cleanedJsonText = rawText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
            const parsed = JSON.parse(cleanedJsonText);
            
            // Tenta la conversione dal formato complesso
            const convertedMarkdown = convertComplexJsonToMarkdown(parsed);
            
            if (convertedMarkdown) {
                console.log("[Proactive-AI] Rilevato e convertito JSON complesso in Markdown.");
                finalAnalysis = convertedMarkdown;
            } else {
                // Se non è il JSON complesso, potremmo cercare l'analisi in altre chiavi
                const analysisKey = Object.keys(parsed).find(k => typeof parsed[k] === 'string' && parsed[k].includes('### Analisi di Pesca'));
            
                if (analysisKey) {
                    console.log(`[Proactive-AI] Rilevato output JSON generico. Estrazione dalla chiave: "${analysisKey}"`);
                    finalAnalysis = parsed[analysisKey];
                } else if (parsed.markdown_analysis) {
                    console.log(`[Proactive-AI] Rilevato output JSON generico. Estrazione dalla chiave "markdown_analysis"`);
                    finalAnalysis = parsed.markdown_analysis;
                }
            }
        } catch (e) {
            // Se il parsing fallisce, significa che è già Markdown puro (il comportamento atteso).
            console.log("[Proactive-AI] Rilevato output Markdown diretto. Nessuna conversione necessaria.");
        }
        
        const timingMs = result.metadata?.timingMs || 'N/D';

        // 2. CACHING DEL RISULTATO
        if (finalAnalysis && finalAnalysis.trim().length > 50) {
            const cacheKey = `analysis-v2-${locationKey}`;
            // NOTA: La struttura della cache è stata semplificata. Ora cachiamo direttamente il Markdown.
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
