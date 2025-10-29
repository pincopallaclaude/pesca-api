import MCP from '@modelcontextprotocol/sdk';
import { initKnowledgeBase } from '../lib/services/vector.service.js';

// Importa tutti i tool
import { generateAnalysis } from './tools/generate-analysis.js';
import { vectorSearch } from './tools/vector-search.js';
import { analyzeWithBestModel } from './tools/analyze-with-best-model.js';
import { recommendForSpecies } from './tools/recommend-for-species.js';
import { extractIntent } from './tools/extract-intent.js';
import { naturalLanguageForecast } from './tools/natural-language-forecast.js';

// Importa la Knowledge Base come risorsa (Resource)
import { knowledgeBase as kbResource } from './resources/knowledge-base.js'; 

// ==========================================
// HELPER: Log su stderr (stdout è riservato al protocollo)
// ==========================================
function serverLog(...args) {
    console.error('[MCP Server]', ...args);
}

// Funzione di avvio asincrona auto-eseguente (IIFE)
(async () => {
    try {
        // 1. Inizializza la KB prima di tutto. (Blocca l'esecuzione)
        serverLog('🚀 Inizializzazione Knowledge Base...');
        await initKnowledgeBase();
        serverLog('✅ Knowledge Base pronta.');

        // 2. Definisci e avvia il server MCP con configurazione dichiarativa.
        const server = new MCP.Server({
            // Impostazioni generali
            metadata: { 
                name: 'pesca-rag-server', 
                version: '1.0.0' 
            },

            // Definizione dei Tool
            tools: {
                // Il nome della chiave è il Tool ID, il valore contiene l'handler e il manifesto (dedotto/automatico)
                vector_search: { handler: vectorSearch },
                generate_analysis: { handler: generateAnalysis },
                analyze_with_best_model: { handler: analyzeWithBestModel },
                recommend_for_species: { handler: recommendForSpecies },
                extract_intent: { handler: extractIntent },
                natural_language_forecast: { handler: naturalLanguageForecast },
            },
            
            // Definizione delle Risorse
            resources: {
                'kb://fishing/knowledge_base': {
                    name: 'Knowledge Base Pesca',
                    mimeType: 'application/json',
                    // Handler per la lettura della risorsa (ReadResourceRequest)
                    readHandler: async ({ uri }) => {
                        serverLog(`📖 ReadResource: ${uri}`);
                        // Restituisce il contenuto raw della knowledge base in formato JSON
                        return {
                            mimeType: 'application/json',
                            text: JSON.stringify(kbResource, null, 2)
                        };
                    },
                },
            },
        });
        
        serverLog('🚀 Avvio server MCP (ascolto su stdio)...');
        // Il metodo listen() del nuovo SDK gestisce automaticamente il transport stdio
        await server.listen();
        serverLog('✅ Server MCP in ascolto e pronto.');
        serverLog('💡 Premi Ctrl+C per terminare');

    } catch (error) {
        serverLog('❌ ERRORE FATALE:', error);
        process.exit(1);
    }
})();
