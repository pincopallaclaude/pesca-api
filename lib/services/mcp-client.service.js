// /lib/services/mcp-client.service.js

import * as logger from '../utils/logger.js';

// Importa DIRETTAMENTE le funzioni dei tool
import { analyzeWithBestModel } from '../../mcp/tools/analyze-with-best-model.js';
import { recommendForSpecies } from '../../mcp/tools/recommend-for-species.js';
// Aggiungi qui gli import per tutti gli altri tool MCP necessari
// import { getHistoricalData } from '../../mcp/tools/get-historical-data.js';

// Mappiamo i nomi dei tool stringa (usati negli handler API) alle funzioni importate
const toolImplementations = {
    'analyze_with_best_model': analyzeWithBestModel,
    'recommend_for_species': recommendForSpecies,
    // Aggiungi qui il mapping per tutti gli altri tool
    // 'get_historical_data': getHistoricalData, 
};

/**
 * Servizio Singleton che simula il client MCP eseguendo i tool localmente.
 */
export const mcpClient = {
    connected: false,

    /**
     * Simula la connessione.
     */
    connect: async () => {
        if (mcpClient.connected) return;
        logger.log('[MCP Mock] Connessione simulata. Esecuzione diretta dei tool.');
        mcpClient.connected = true;
    },

    /**
     * Simula la disconnessione.
     */
    disconnect: async () => {
        if (!mcpClient.connected) return;
        logger.log('[MCP Mock] Disconnessione simulata.');
        mcpClient.connected = false;
    },

    /**
     * Chiama direttamente la funzione del tool importato in base al suo nome.
     * Accetta un oggetto destrutturato { name, arguments } per mantenere la compatibilità
     * con il formato dell'API Gemini, ma usa i parametri diretti per l'esecuzione.
     * @param {object} toolInvocation L'oggetto di invocazione del tool
     * @param {string} toolInvocation.name Il nome del tool da chiamare
     * @param {object} toolInvocation.arguments Gli argomenti del tool come oggetto
     */
    callTool: async ({ name: toolName, arguments: params }) => {
        if (!mcpClient.connected) {
            // Tentativo di auto-connessione se non è pronto
            await mcpClient.connect();
        }
        
        logger.log(`[MCP Mock] Ricevuta chiamata per tool: '${toolName}'`);

        const toolFunction = toolImplementations[toolName];

        if (typeof toolFunction === 'function') {
            try {
                logger.log(`[MCP Mock] 🔧 Chiamata diretta a tool: ${toolName}`);
                // Chiama la funzione corrispondente al nome del tool
                const result = await toolFunction(params);
                logger.log(`[MCP Mock] ✅ Tool ${toolName} completato`);
                return result;
            } catch (error) {
                logger.error(`[MCP Mock] ❌ Errore tool '${toolName}': ${error.message}`);
                // In caso di errore, restituisce un oggetto strutturato per notificare l'errore al chiamante
                return { isError: true, content: [{ type: 'text', text: error.message }] };
            }
        } else {
            logger.error(`[MCP Mock] Tool non mappato/trovato: ${toolName}`);
            throw new Error(`Tool non trovato: ${toolName}`);
        }
    }
};