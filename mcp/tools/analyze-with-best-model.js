// mcp/tools/analyze-with-best-model.js

import { queryKnowledgeBase } from '../../lib/services/chromadb.service.js';
import { generateAnalysis } from '../../lib/services/gemini.service.js';
import * as claude from '../../lib/services/claude.service.js';
import * as mistral from '../../lib/services/mistral.service.js';
import * as logger from '../../lib/utils/logger.js';

function determineComplexity(weatherData) {
    let complexityScore = 0;
    if (weatherData.pescaScoreData.numericScore < 4) complexityScore++;
    if (parseFloat(weatherData.ventoDati) > 20) complexityScore++;
    if (weatherData.trendPressione === '↓' || weatherData.trendPressione === '↑') complexityScore++;
    return complexityScore > 1 ? 'high' : 'low';
}

async function selectModel(complexity, location) {
    const isPremiumLocation = location.toLowerCase().includes('posillipo');
    logger.log(`[MCP Multi-Model] 🤖 Routing per ${location}...`);
    logger.log(`[MCP Multi-Model] 📊 Complessità: ${complexity} (score: ${complexity === 'high' ? 2 : 1})`);
    
    if (isPremiumLocation && complexity === 'high') {
        logger.log(`[MCP Multi-Model] 🎯 Routing premium: claude`);
        return { model: claude, provider: 'anthropic', modelUsed: 'claude-3-sonnet' };
    }
    if (complexity === 'high') {
        logger.log(`[MCP Multi-Model] 🎯 Routing avanzato: mistral`);
        return { model: mistral, provider: 'mistralai', modelUsed: 'open-mistral-7b' };
    }
    logger.log(`[MCP Multi-Model] 🎯 Routing automatico: gemini (Claude: ${isPremiumLocation}, Mistral: true)`);
    return { model: { generateChatCompletion: generateAnalysis }, provider: 'google', modelUsed: 'gemini-2.5-flash' };
}


export async function analyzeWithBestModel({ weatherData, location }) {
    
    try {
        logger.log(`[MCP Tool] 🔧 Esecuzione di analyzeWithBestModel...`);
        const complexity = determineComplexity(weatherData);
        let { model, provider, modelUsed } = await selectModel(complexity, location);

        const query = `consigli e tecniche di pesca per condizioni meteo: ${weatherData.weatherDesc}, vento ${weatherData.ventoDati}, mare ${weatherData.mare}, e pressione ${weatherData.pressione} hPa.`;
        
        logger.log('[MCP Multi-Model] 🔍 Eseguo query RAG su ChromaDB con re-ranking attivato...');
        const contextDocs = await queryKnowledgeBase(query, {
            topK: 5,
            filters: null,
            useReranking: true,
            rerankTopK: 15
        });
                
        logger.log(`[MCP Multi-Model] ✅ Trovati ${contextDocs.length} documenti KB`);
        const contextText = contextDocs.map(doc => `Contesto: ${doc.content}`).join('\n\n');

        const prompt = `
            Sei un esperto di pesca... (Il tuo prompt completo qui)
            **Contesto dalla Knowledge Base:**
            ${contextText || "Nessun contesto specifico trovato."}
        `;

        let analysis;
        let elapsed;

        // --- INIZIO LOGICA DI FALLBACK ---
        try {
            const startTime = Date.now();
            logger.log(`[MCP Multi-Model] ▶️ Tentativo di generazione con ${modelUsed}...`);
            analysis = await model.generateChatCompletion(prompt);
            elapsed = Date.now() - startTime;
            logger.log(`[MCP Multi-Model] 🏁 Completato con ${modelUsed} in ${elapsed}ms`);
        } catch (primaryError) {
            logger.error(`[MCP Multi-Model] ⚠️ Fallimento del modello primario (${modelUsed}): ${primaryError.message}`);
            
            // Se il modello fallito è Gemini (google), tenta il fallback su Mistral
            if (provider === 'google') {
                logger.warn(`[MCP Multi-Model] 🔄 Eseguo fallback automatico su Mistral...`);
                modelUsed = 'open-mistral-7b (fallback)';
                provider = 'mistralai';
                model = mistral; // Usa direttamente il servizio Mistral importato
                
                const startTime = Date.now();
                analysis = await model.generateChatCompletion(prompt);
                elapsed = Date.now() - startTime;
                logger.log(`[MCP Multi-Model] 🏁 Completato con ${modelUsed} in ${elapsed}ms`);
            } else {
                // Se non era Gemini a fallire, o se anche il fallback fallisce, rilancia l'errore originale
                throw primaryError;
            }
        }
        // --- FINE LOGICA DI FALLBACK ---

        if (!analysis || analysis.trim() === '') {
            throw new Error("La chiamata AI (inclusi i fallback) ha restituito un risultato vuoto.");
        }

        return {
            isError: false,
            content: [{ type: 'text', text: analysis }],
            metadata: {
                modelUsed: modelUsed,
                provider: provider,
                complexityLevel: complexity,
                contextDocsCount: contextDocs.length,
                timingMs: elapsed,
            }
        };
    } catch (error) {
        logger.error(`[MCP Tool] ❌ Errore critico in analyzeWithBestModel: ${error.message}`);
        return {
            isError: true,
            content: [{ type: 'text', text: `Errore durante la generazione dell'analisi: ${error.message}` }],
            metadata: {}
        };
    }
}