// /mcp/tools/analyze-with-best-model.js

import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';
import { generateWithMistral, isMistralAvailable } from '../../lib/services/mistral.service.js';
import { generateWithClaude, isClaudeAvailable } from '../../lib/services/claude.service.js';
import { queryKnowledgeBase } from '../../lib/services/vector.service.js';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

/**
 * MCP Tool: Analyze With Best Model
 * Routing intelligente tra Claude, Mistral e Gemini basato sulla complessità meteo.
 */
export async function analyzeWithBestModel({ weatherData, location, forceModel = null }) {
    const startTime = Date.now();
    try {
        log(`[MCP Multi-Model] 🤖 Routing per ${location}...`);

        const complexity = assessWeatherComplexity(weatherData);
        log(`[MCP Multi-Model] 📊 Complessità: ${complexity.level} (score: ${complexity.score})`);

        let selectedModel;
        if (forceModel) {
            selectedModel = forceModel;
            log(`[MCP Multi-Model] 🔧 Modello forzato: ${selectedModel}`);
        } else {
            // Logica di routing a 3 livelli: Premium (Claude) -> Free Upgrade (Mistral) -> Free Baseline (Gemini)
            const claudeAvailable = await isClaudeAvailable();
            const mistralAvailable = await isMistralAvailable();

            if (complexity.level === 'high' && claudeAvailable) {
                selectedModel = 'claude'; // Priorità 1: Modello a pagamento per massima qualità
            } else if (complexity.level === 'high' && mistralAvailable) {
                selectedModel = 'mistral'; // Priorità 2: Alternativa gratuita/economica per compiti complessi
            } else {
                selectedModel = 'gemini'; // Default per condizioni standard o come fallback
            }
            log(`[MCP Multi-Model] 🎯 Routing automatico: ${selectedModel} (Claude: ${claudeAvailable}, Mistral: ${mistralAvailable})`);
        }

        // --- RAG (Retrieval-Augmented Generation) ---
        const searchQuery = `Condizioni meteo pesca per ${location} con vento ${weatherData?.dailyWindSpeedKn?.toFixed(1) || 'N/D'} nodi, mare ${weatherData.mare || 'N/D'}, temperatura acqua ${weatherData.temperaturaAvg || 'N/D'}°C`;
        const relevantDocs = await queryKnowledgeBase(searchQuery, 5);
        log(`[MCP Multi-Model] ✅ Trovati ${relevantDocs.length} documenti KB`);

        // Costruisci il prompt arricchito
        const enrichedPrompt = buildPrompt(weatherData, location, relevantDocs, complexity);

        let analysis;
        let modelUsed;
        let modelMetadata = {};

        // --- Chiamata all'LLM Selezionato ---
        if (selectedModel === 'claude') {
            analysis = await generateWithClaude(enrichedPrompt, { max_tokens: complexity.level === 'high' ? 3000 : 2000 });
            modelUsed = 'claude-3-sonnet';
            modelMetadata = { provider: 'anthropic', reason: complexity.reason };
        } else if (selectedModel === 'mistral') {
            analysis = await generateWithMistral(enrichedPrompt); // Uso il modello di default interno al servizio
            modelUsed = 'open-mistral-7b';
            modelMetadata = { provider: 'mistral', reason: `Alternativa gratuita per complessità ${complexity.level}` };
        } else {
            // Gemini (fallback o per complessità bassa/media)
            analysis = await geminiGenerate(enrichedPrompt);
            modelUsed = 'gemini-2.5-flash';
            modelMetadata = { provider: 'google', reason: complexity.level === 'low' ? 'Condizioni standard' : 'Fallback (Modelli superiori non necessari o non disponibili)' };
        }

        const elapsed = Date.now() - startTime;
        log(`[MCP Multi-Model] 🏁 Completato con ${modelUsed} in ${elapsed}ms`);

        // Restituisce il risultato nel formato standard MCP Tool Output
        return {
            content: [{ type: 'text', text: analysis }],
            metadata: { modelUsed, ...modelMetadata, complexityLevel: complexity.level, complexityScore: complexity.score, documentsUsed: relevantDocs.length, timingMs: elapsed, generatedAt: new Date().toISOString() }
        };
    } catch (error) {
        // Sostituito console.error con log
        log(`[MCP Multi-Model] ❌ Errore: ${error.message}`);
        // Assicurati che l'errore sia gestito e lanciato correttamente per l'MCP
        throw new Error(`Multi-model analysis failed: ${error.message}`);
    }
}

// Funzioni di supporto (rimangono invariate)

function assessWeatherComplexity(weatherData) {
    let score = 0;
    const reasons = [];
    const hourlyData = weatherData.hourly || [];

    const windSpeeds = hourlyData.map(h => h.windSpeedKn * 1.852);
    if (windSpeeds.length > 0) {
        const windVariance = calculateVariance(windSpeeds);
        if (windVariance > 50) { score += 3; reasons.push('Alta variabilità vento'); }
        else if (windVariance > 25) { score += 1; }
    }

    const waveHeights = hourlyData.map(h => h.waveHeight);
    if(waveHeights.length > 0) {
        const maxWave = Math.max(...waveHeights);
        if (maxWave > 2.5) { score += 3; reasons.push('Mare molto mosso'); }
        else if (maxWave > 1.5) { score += 1; }
    }

    const seaTemp = hourlyData[0]?.waterTemperature || 20;
    if (seaTemp < 10 || seaTemp > 26) { score += 2; reasons.push('Temperatura acqua estrema'); }

    if (hourlyData.some(h => h.currentSpeedKn && h.currentSpeedKn !== 'N/D')) { score += 1; reasons.push('Corrente marina disponibile'); }

    if (weatherData.trendPressione === '↓' || weatherData.trendPressione === '↑') {
        score += 2;
        reasons.push(`Pressione in ${weatherData.trendPressione === '↓' ? 'calo' : 'aumento'}`);
    }

    const level = score >= 7 ? 'high' : (score >= 4 ? 'medium' : 'low');
    return { level, score, reason: reasons.join(', ') || 'Condizioni standard' };
}

function calculateVariance(arr) {
    if (arr.length <= 1) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
}

function buildPrompt(weatherData, location, relevantDocs, complexity) {
    // Rimuoviamo l'array 'hourly' per un prompt più pulito
    const summaryData = { ...weatherData };
    delete summaryData.hourly;
    delete summaryData.pescaScoreData;

    return `
# Analisi Pesca per ${location}
## Livello Complessità Meteo: ${complexity.level.toUpperCase()} (Motivo: ${complexity.reason})
## Dati Meteo-Marini Sintetici
${JSON.stringify(summaryData, null, 2)}
## Conoscenza dalla Knowledge Base
${relevantDocs.map((doc, i) => `### Documento ${i + 1}\n${doc}`).join('\n')}
## Istruzioni
${complexity.level === 'high' ? 'Genera un\'analisi APPROFONDITA e DETTAGLIATA.' : 'Genera un\'analisi CONCISA ma completa.'}

La tua risposta DEVE essere un testo discorsivo formattato in Markdown, pronto per essere mostrato a un utente.
NON restituire un oggetto JSON o un blocco di codice JSON.

Includi i seguenti punti nella tua analisi testuale:
1. Valutazione condizioni generali
2. Specie target consigliate con motivazioni
3. Tecniche specifiche e strategie
4. Esche/attrezzatura consigliate
5. Orari e finestre di pesca ottimali

Stile: Professionale, chiaro e accessibile.`;
}
