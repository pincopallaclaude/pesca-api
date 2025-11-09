// /lib/services/mcp-client.service.js

import * as logger from '../utils/logger.js';
// Importa DIRETTAMENTE i tool per l'esecuzione in-process.
// Assicurati che i nomi dei file riflettano i nomi dei tool utilizzati nell'applicazione.
import { analyzeWithBestModel } from '../../mcp/tools/analyze-with-best-model.js';
import { recommendForSpecies } from '../../mcp/tools/recommend-for-species.js';
// Aggiungi qui gli import per tutti gli altri tool MCP necessari
// Ad esempio: 
// import { getHistoricalData } from '../../mcp/tools/get-historical-data.js';

/**
 * Servizio Singleton che simula il client MCP eseguendo i tool localmente.
 */
class MockMcpClient {
    constructor() {
        this.connected = false;
        // Mappa i nomi delle tool stringa (usati negli handler API) alle funzioni reali
        this.toolMap = {
            'analyze_with_best_model': analyzeWithBestModel,
            'recommend_for_species': recommendForSpecies,
            // Aggiungi qui il mapping per tutti gli altri tool
            // 'get_historical_data': getHistoricalData, 
        };
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
     */
    async callTool({ name, arguments: params }) {
        if (!this.connected) {
            // Tentativo di auto-connessione se non è pronto
            await this.connect();
        }

        const toolFunction = this.toolMap[name];

        if (!toolFunction) {
            logger.error(`[MCP Mock] Tool non mappato/trovato: ${name}`);
            throw new Error(`Tool non trovato: ${name}`);
        }

        try {
            logger.log(`[MCP Mock] 🔧 Chiamata diretta a tool: ${name}`);
            // Esegue la funzione del tool con i parametri forniti
            const result = await toolFunction(params); 
            logger.log(`[MCP Mock] ✅ Tool ${name} completato`);
            return result;
        } catch (error) {
            logger.error(`[MCP Mock] ❌ Errore tool ${name} (Esecuzione locale):`, error.message);
            throw error;
        }
    }
}

export const mcpClient = new MockMcpClient();