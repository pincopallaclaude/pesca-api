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
class MockMcpClient {
    constructor() {
        this.connected = false;
        // La mappa toolImplementations ora è esterna alla classe
    }

    /**
     * Simula la connessione.
     */
    async connect() {
        if (this.connected) return;
        logger.log('[MCP Mock] Connessione simulata. Esecuzione diretta dei tool.');
        this.connected = true;
    }

    /**
     * Simula la disconnessione.
     */
    async disconnect() {
        if (!this.connected) return;
        logger.log('[MCP Mock] Disconnessione simulata.');
        this.connected = false;
    }

    /**
     * Chiama direttamente la funzione del tool importato in base al suo nome.
     * @param {string} toolName Il nome del tool da chiamare (es. 'analyze_with_best_model')
     * @param {object} params Gli argomenti del tool come oggetto
     */
    async callTool({ name: toolName, arguments: params }) {
        if (!this.connected) {
            // Tentativo di auto-connessione se non è pronto
            await this.connect();
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
                logger.error(`[MCP Mock] ❌ Errore durante l'esecuzione del tool '${toolName}': ${error.message}`);
                // In caso di errore, restituisce un oggetto strutturato per notificare l'errore al chiamante
                return { isError: true, content: [{ type: 'text', text: error.message }] };
            }
        } else {
            logger.error(`[MCP Mock] Tool non mappato/trovato: ${toolName}`);
            throw new Error(`Tool non trovato: ${toolName}`);
        }
    }
}

export const mcpClient = new MockMcpClient();