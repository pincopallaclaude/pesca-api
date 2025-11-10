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
     * @param {...any} args Gli argomenti passati (per debugging e flessibilità)
     */
    callTool: async function(...args) {
        // --- DEBUG ESTREMO: ARGOMENTI RICEVUTI DA callTool ---
        console.log('--- DEBUG ESTREMO: ARGOMENTI RICEVUTI DA callTool ---');
        console.log(`Numero di argomenti: ${args.length}`);
        args.forEach((arg, index) => {
            console.log(`Argomento ${index}:`, arg);
            console.log(`Tipo dell'argomento ${index}:`, typeof arg);
        });
        console.log('----------------------------------------------------');

        // La logica precedente gestiva: { name: toolName, arguments: params }
        // La logica di testing assume: toolName = args[0] e params = args[1]
        
        // Dobbiamo estrarre il toolName e i params in base al formato atteso dal chiamante.
        // Se args.length == 1 e args[0] è un oggetto con 'name' e 'arguments', usiamo la vecchia logica.
        // Se args.length >= 2, assumiamo (come da tuo NEW snippet) che args[0] = toolName e args[1] = params.
        
        let toolName, params;
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && args[0].name && args[0].arguments) {
            // Formato standard API (vecchia implementazione): callTool({ name: '...', arguments: {...} })
            toolName = args[0].name;
            params = args[0].arguments;
        } else if (args.length >= 2) {
            // Formato semplificato (nuova ipotesi di testing): callTool('...', {...})
            toolName = args[0];
            params = args[1];
        } else {
             logger.error(`[MCP Mock] Chiamata callTool non valida. Argomenti: ${JSON.stringify(args)}`);
             throw new Error("Formato di chiamata callTool non riconosciuto. Non è stato possibile estrarre nome tool e parametri.");
        }


        if (!mcpClient.connected) {
            // Tentativo di auto-connessione se non è pronto
            await mcpClient.connect();
        }

        logger.log(`[MCP Mock] Ricevuta chiamata per tool: '${toolName}' (Eseguo logica)`);

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