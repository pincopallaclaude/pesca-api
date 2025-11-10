// mcp/tools/analyze-with-best-model.js
import { queryKnowledgeBase } from '../../lib/services/vector.service.js';
// --- CORREZIONE: Il nome corretto della funzione è 'generateGeminiChatCompletion' ---
import { generateGeminiChatCompletion } from '../../lib/services/gemini.service.js'; 
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
    // --- CORREZIONE: Usiamo il nome corretto della funzione anche qui ---
    return { model: { generateChatCompletion: generateGeminiChatCompletion }, provider: 'google', modelUsed: 'gemini-1.5-flash' };
}

export async function analyzeWithBestModel({ weatherData, location }) {
    logger.log(`[MCP Mock] 🔧 Chiamata diretta a tool: analyzeWithBestModel`);
    const complexity = determineComplexity(weatherData);
    const { model, provider, modelUsed } = await selectModel(complexity, location);

    const query = `consigli e tecniche di pesca per condizioni meteo: ${weatherData.weatherDesc}, vento ${weatherData.ventoDati}, mare ${weatherData.mare}, e pressione ${weatherData.pressione} hPa.`;
    
    const filters = {};
    // Disabilitiamo il filtro per far funzionare la ricerca
    logger.log(`[MCP Multi-Model] 🔎 Filtri ChromaDB:`, filters);

    logger.log('[MCP Multi-Model] 🔍 Eseguo query RAG su ChromaDB con re-ranking attivato...');
    const contextDocs = await queryKnowledgeBase(query, {
        topK: 5,
        filters: Object.keys(filters).length > 0 ? filters : null,
        useReranking: true,
        rerankTopK: 15
    });
    
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

        **Finestre di Pesca Ottimali:**
        - Mattina: ${weatherData.finestraMattino.orario}
        - Sera: ${weatherData.finestraSera.orario}

        **Consigli e Strategie:**
        Basandoti **SOPRATTUTTO SUL CONTESTO FORNITO**, fornisci una strategia di pesca chiara e utile. Elabora i seguenti punti:
        1.  **Tecniche Consigliate:** Quali tecniche sono più efficaci con queste condizioni? (es. eging, spinning, bolentino)
        2.  **Attrezzatura:** Che tipo di attrezzatura (canne, mulinelli, esche) è meglio usare? Sii specifico.
        3.  **Prede Potenziali:** Quali pesci sono più attivi e catturabili?
        4.  **Consiglio Pro:** Un suggerimento da esperto per massimizzare le catture oggi.

        **Contesto dalla Knowledge Base:**
        ${contextText || "Nessun contesto specifico trovato."}
    `;

    const startTime = Date.now();
    const analysis = await model.generateChatCompletion(prompt);
    const elapsed = Date.now() - startTime;
    logger.log(`[MCP Multi-Model] 🏁 Completato con ${modelUsed} in ${elapsed}ms`);

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
}