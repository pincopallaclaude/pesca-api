// /mcp/tools/natural-language-forecast.js

import { extractIntent } from './extract-intent.js';
import { recommendForSpecies } from './recommend-for-species.js';
import { analyzeWithBestModel } from './analyze-with-best-model.js';
// I percorsi seguenti sono stati corretti per essere due livelli sopra (dal tool MCP)
// e poi scendere in lib/services.
import { queryKnowledgeBase } from '../../lib/services/vector.service.js'; 
import { generateAnalysis } from '../../lib/services/gemini.service.js';

const log = (msg) => process.stderr.write(`${msg}\n`);

export async function naturalLanguageForecast({ query, weatherData = null, location = null }) {
    const startTime = Date.now();
    try {
        // CORRETTO: Sostituito console.log con log
        log(`[MCP NL Forecast] 🗣️ Query: "${query}"`);
        
        const intentResult = await extractIntent({ query });
        const intent = JSON.parse(intentResult.content[0].text);
        
        const targetLocation = location || intent.location;
        if (!targetLocation && intent.type !== 'general_advice') {
            return { content: [{ type: 'text', text: JSON.stringify(buildErrorResponse('Località non specificata.')) }]};
        }
        
        let response;
        switch (intent.type) {
            case 'species_recommendation':
                if (!intent.species) { response = buildErrorResponse('Specie non specificata.'); break; }
                if (!weatherData) { response = buildNeedsForecastResponse(targetLocation, intent.species); break; }
                const speciesResult = await recommendForSpecies({ species: intent.species, weatherData, location: targetLocation });
                response = { answer: speciesResult.content[0].text, type: 'species_recommendation', metadata: speciesResult.metadata };
                break;
            case 'forecast':
            case 'best_time':
                if (!weatherData) { response = buildNeedsForecastResponse(targetLocation); break; }
                const analysisResult = await analyzeWithBestModel({ weatherData, location: targetLocation });
                response = { answer: analysisResult.content[0].text, type: intent.type, metadata: analysisResult.metadata };
                break;
            default: // general_advice
                response = await handleGeneralAdvice(intent);
                break;
        }

        const elapsed = Date.now() - startTime;
        // CORRETTO: Sostituito console.log con log
        log(`[MCP NL Forecast] 🏁 Completato in ${elapsed}ms`);
        
        return {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
            metadata: { originalQuery: query, intentType: intent.type, timingMs: elapsed }
        };
    } catch (error) {
        // La chiamata log era già corretta qui, ma ho standardizzato la sintassi
        log(`[MCP NL Forecast] ❌ Errore: ${error.message}`);
        throw new Error(`Natural language forecast failed: ${error.message}`);
    }
}

function buildErrorResponse(message) { return { answer: `❌ ${message}`, type: 'error', needsAction: 'clarification' }; }
function buildNeedsForecastResponse(location, species = null) { return { answer: `Per rispondere, ho bisogno dei dati meteo per ${location}. Richiedili e riprova.`, type: 'needs_forecast', needsAction: 'fetch_forecast', actionParams: { location } }; }

async function handleGeneralAdvice(intent) {
    // Qui si presume che queryKnowledgeBase e generateAnalysis siano funzioni disponibili
    const docs = await queryKnowledgeBase(intent.originalQuery, 3);
    if (docs.length === 0) return { answer: 'Non ho trovato informazioni. Prova a riformulare la domanda.', type: 'general_advice', kbEmpty: true };
    const prompt = `Domanda: ${intent.originalQuery}\nInfo dalla KB:\n${docs.map(d => d.text).join('\n\n')}\nFornisci una risposta concisa e utile.`;
    const answer = await generateAnalysis(prompt);
    return { answer, type: 'general_advice', sourcesUsed: docs.length };
}
