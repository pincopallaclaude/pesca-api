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
    return { model: { generateChatCompletion: generateAnalysis }, provider: 'google', modelUsed: 'gemini-1.5-flash' };
}


export async function analyzeWithBestModel({ weatherData, location }) {
    
    try {
        logger.log(`[MCP Tool] 🔧 Esecuzione di analyzeWithBestModel...`);
        const complexity = determineComplexity(weatherData);
        const { model, provider, modelUsed } = await selectModel(complexity, location);

        const query = `consigli e tecniche di pesca per condizioni meteo: ${weatherData.weatherDesc}, vento ${weatherData.ventoDati}, mare ${weatherData.mare}, e pressione ${weatherData.pressione} hPa.`;
        
        // Ho rimosso l'oggetto 'filters' non utilizzato per pulizia del codice, 
        // e rimosso il log ad esso associato.

        logger.log('[MCP Multi-Model] 🔍 Eseguo query RAG su ChromaDB con re-ranking attivato...');
        const contextDocs = await queryKnowledgeBase(query, {
            topK: 5,
            filters: null, // Passiamo null direttamente
            useReranking: true,
            rerankTopK: 15
        });
        
        // --- LOG DI DEBUG MANTENUTI ---
        console.log("--- DEBUG RE-RANKER ---");
        console.log("Risultato di queryKnowledgeBase (dovrebbe includere il re-ranking):");
        // Stampiamo la struttura per vedere se ci sono elementi undefined
        console.log(JSON.stringify(contextDocs, null, 2)); 
        console.log(`Numero di documenti ricevuti: ${contextDocs ? contextDocs.length : 'null'}`);
        console.log("--- FINE DEBUG RE-RANKER ---");
        // --- FINE LOG ---
        
        logger.log(`[MCP Multi-Model] ✅ Trovati ${contextDocs.length} documenti KB`);
        const contextText = contextDocs.map(doc => `Contesto: ${doc.content}`).join('\n\n');

        const prompt = `
            Sei un esperto di pesca a livello mondiale. Analizza i seguenti dati meteo per ${location} e fornisci consigli di pesca dettagliati in formato Markdown.
            
            **Condizioni Meteo:**
            - Meteo: ${weatherData.weatherDesc}
            - Vento: ${weatherData.ventoDati}
            - Pressione: ${weatherData.pressione} hPa (Tendenza: ${weatherData.trendPressione})
            - Mare: ${weatherData.mare}
            - Punteggio Pesca: ${weatherData.pescaScoreData.displayScore}/10

            **Consigli e Strategie:**
            Basandoti sul contesto fornito e la tua conoscenza, elabora:
            1. Tecniche Consigliate
            2. Attrezzatura e Esche
            3. Prede Potenziali
            4. Consiglio Pro

            **Contesto dalla Knowledge Base:**
            ${contextText || "Nessun contesto specifico trovato."}
        `;

        const startTime = Date.now();
        const analysis = await model.generateChatCompletion(prompt);
        const elapsed = Date.now() - startTime;
        logger.log(`[MCP Multi-Model] 🏁 Completato con ${modelUsed} in ${elapsed}ms`);

        // Se 'analysis' è null o undefined per qualche motivo, restituisci un testo di fallback
        if (!analysis) {
            logger.warn(`[MCP Tool] La chiamata AI ha restituito un risultato vuoto. Uso un testo di fallback.`);
            throw new Error("La chiamata AI ha restituito un risultato vuoto.");
        }

        return {
            isError: false,
            content: [{ type: 'text', text: analysis }],
            metadata: {
                modelUsed: modelUsed,
                provider: provider,
                complexityLevel: complexity,
                contextDocsCount: contextDocs.length
            }
        };
    } catch (error) {
        logger.error(`[MCP Tool] ❌ Errore critico in analyzeWithBestModel: ${error.message}`);
        // Restituisce SEMPRE un oggetto di errore strutturato
        return {
            isError: true,
            content: [{ type: 'text', text: `Errore durante la generazione dell'analisi: ${error.message}` }],
            metadata: {}
        };
    }
}