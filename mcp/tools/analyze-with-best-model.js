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
        // NUOVO LOGGING DETTAGLIATO
        log(`[MCP Multi-Model] 📊 Complessità calcolata: ${complexity.level} (Score: ${complexity.score})`);

        let selectedModel;
        let routingReason;

        if (forceModel) {
            selectedModel = forceModel;
            routingReason = `Modello forzato via API`;
        } else {
            // NUOVA LOGICA DI ROUTING A 3 LIVELLI
            const claudeAvailable = await isClaudeAvailable();
            const mistralAvailable = await isMistralAvailable();

            if (complexity.level === 'high' && claudeAvailable) {
                selectedModel = 'claude';
                routingReason = `Complessità alta e Claude disponibile`;
            } else if ((complexity.level === 'high' || complexity.level === 'medium') && mistralAvailable) {
                selectedModel = 'mistral';
                routingReason = `Complessità ${complexity.level} e Mistral disponibile come free upgrade`;
            } else {
                selectedModel = 'gemini';
                routingReason = `Complessità bassa o fallback predefinito`;
            }
        }
        // NUOVO LOGGING DETTAGLIATO
        log(`[MCP Multi-Model] 🎯 Routing Decisione: ${selectedModel.toUpperCase()} | Motivo: ${routingReason}`);

        // --- RAG - Logica di Ricerca Multi-Vettore ---
        // Pulisce la location da dettagli come "(zona Napoli)"
        const cleanLocation = location.split('(')[0].trim();
        // Estrae solo la prima parola dello stato del mare e la rende minuscola
        const seaState = (weatherData.mare || 'calmo').split(' ')[0].toLowerCase();

        // 1. Crea una query primaria, molto specifica.
        const primaryQuery = `tecniche pesca ${cleanLocation} con mare ${seaState}`;

        // 2. Crea query secondarie, più generiche, per ampliare la ricerca.
        const secondaryQueries = [
            `consigli pesca con mare ${seaState}`,
            `migliori spot ${cleanLocation}`
        ];

        // 3. Esegui tutte le query in parallelo.
        const [primaryDocs, secondaryDocs] = await Promise.all([
            queryKnowledgeBase(primaryQuery, 3), // Cerca 3 documenti per la query principale
            // Combina le query secondarie in una singola stringa per la ricerca generica
            queryKnowledgeBase(secondaryQueries.join(' '), 2) 
        ]);

        // 4. Unisci e deduplica i risultati.
        const allDocsMap = new Map();
        [...primaryDocs, ...secondaryDocs].forEach(doc => {
            // Usiamo il contenuto del testo come chiave per evitare duplicati
            if (doc && doc.text) {
                allDocsMap.set(doc.text, doc);
            }
        });
        const relevantDocs = Array.from(allDocsMap.values());
        
        log(`[MCP Multi-Model] ✅ Trovati ${relevantDocs.length} documenti KB per query "${primaryQuery}" e altre`);

        // Costruisci il prompt arricchito (MAPPATO relevantDocs in .text)
        const enrichedPrompt = buildPrompt(weatherData, location, relevantDocs.map(d => d.text), complexity);

        let analysis;
        let modelUsed;
        let modelMetadata = {};

        // --- Chiamata all'LLM Selezionato ---
        if (selectedModel === 'claude') {
            analysis = await generateWithClaude(enrichedPrompt, { max_tokens: complexity.level === 'high' ? 3000 : 2000 });
            modelUsed = 'claude-3-sonnet';
            modelMetadata = { provider: 'anthropic', reason: routingReason }; // Uso routingReason
        } else if (selectedModel === 'mistral') {
            analysis = await generateWithMistral(enrichedPrompt); // Uso il modello di default interno al servizio
            modelUsed = 'open-mistral-7b';
            modelMetadata = { provider: 'mistral', reason: routingReason }; // Uso routingReason
        } else {
            // Gemini (fallback o per complessità bassa/media)
            analysis = await geminiGenerate(enrichedPrompt);
            modelUsed = 'gemini-2.5-flash';
            modelMetadata = { provider: 'google', reason: routingReason }; // Uso routingReason
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
${complexity.level === 'high' ? 'Genera analisi APPROFONDITA e DETTAGLIATA. Condizioni complesse richiedono spiegazioni estese.' : 'Genera analisi CONCISA ma completa.'}
Includi: 1. Valutazione condizioni generali 2. Specie target consigliate 3. Tecniche specifiche 4. Esche/attrezzatura 5. Orari ottimali.
Stile: Professionale ma accessibile.

**REGOLE DI OUTPUT OBBLIGATORIE:**
- **FORMATO:** La risposta DEVE essere unicamente testo formattato in Markdown.
- **NO JSON:** NON includere MAI \`\`\`json, oggetti JSON o codice JSON nella risposta.`;
}
