// /lib/services/mcp-client.service.js

import * as logger from '../utils/logger.js';

// Importa DIRETTAMENTE le funzioni dei tool
import { analyzeWithBestModel } from '../../mcp/tools/analyze-with-best-model.js';
import { recommendForSpecies } from '../../mcp/tools/recommend-for-species.js';
// Aggiungi qui gli import per altri tool se necessario

// Mappiamo i nomi dei tool alle funzioni importate
const toolImplementations = {
    'analyze_with_best_model': analyzeWithBestModel,
    'recommend_for_species': recommendForSpecies,
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
        logger.log('[MCP Mock] Connessione simulata.');
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
     * Chiama direttamente la funzione del tool, gestendo correttamente il risultato.
     * @param {string} toolName Il nome del tool da chiamare.
     * @param {object} params I parametri da passare al tool.
     * @returns {Promise<object>} Il risultato del tool, nel formato { isError, content, metadata }.
     */
    callTool: async (toolName, params) => {
        if (!mcpClient.connected) {
            await mcpClient.connect();
        }

        logger.log(`[MCP Mock] Ricevuta chiamata per tool: '${toolName}'`);

        const toolFunction = toolImplementations[toolName];

        if (typeof toolFunction === 'function') {
            try {
                logger.log(`[MCP Mock] 🔧 Chiamata diretta a tool: ${toolName}`);
                // Chiama la funzione e restituisce direttamente il suo risultato
                const result = await toolFunction(params);
                logger.log(`[MCP Mock] ✅ Tool ${toolName} completato.`);
                return result;
            } catch (error) {
                logger.error(`[MCP Mock] ❌ Errore durante l'esecuzione del tool '${toolName}': ${error.message}`);
                // In caso di errore, restituisce un oggetto strutturato per notificare l'errore al chiamante
                return { isError: true, content: [{ type: 'text', text: error.message }], metadata: {} };
            }
        } else {
            const errorMessage = `Tool non mappato o non trovato: ${toolName}`;
            logger.error(`[MCP Mock] ${errorMessage}`);
            // Restituisce un oggetto di errore strutturato
            return { isError: true, content: [{ type: 'text', text: errorMessage }], metadata: {} };
        }
    }
};