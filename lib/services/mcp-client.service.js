// /lib/services/mcp-client.service.js

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Servizio Singleton per la gestione della connessione al server MCP.
 */
class McpClientService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connectionPromise = null;
  }

  /**
   * Stabilisce la connessione al server MCP con retry logic.
   */
  async connect() {
    if (this.connected) {
      console.log('[MCP Client] ℹ️ Già connesso');
      return;
    }
    
    if (this.connectionPromise) {
      console.log('[MCP Client] ⏳ Connessione in corso, attendo...');
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      const maxRetries = 3;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`[MCP Client] 🔌 Tentativo connessione ${attempt}/${maxRetries}...`);
          
          // Inizializza client
          this.client = new Client(
            { name: 'pesca-api-client', version: '1.0.0' },
            { capabilities: {} }
          );

          // Path assoluto al server
          const serverPath = join(__dirname, '../../mcp/server.js');
          console.log(`[MCP Client] 📍 Server path: ${serverPath}`);

          // Crea transport con timeout esteso
          const transport = new StdioClientTransport({
            command: 'node',
            args: [serverPath],
            env: {
              ...process.env,
              NODE_NO_WARNINGS: '1'
            }
          });

          // Aggiungi listener per debug
          transport.onerror = (error) => {
            console.error('[MCP Client] ⚠️ Transport error:', error);
          };

          transport.onclose = () => {
            console.log('[MCP Client] 🔌 Transport chiuso');
          };

          // Connetti con timeout
          const connectionTimeout = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Timeout connessione (30s)')), 30000);
          });

          await Promise.race([
            this.client.connect(transport),
            connectionTimeout
          ]);

          this.connected = true;
          console.log('[MCP Client] ✅ Connesso al server MCP');
          
          // Test connessione: lista tools
          try {
            const tools = await this.client.listTools();
            console.log(`[MCP Client] 🔧 Tools disponibili: ${tools.tools.map(t => t.name).join(', ')}`);
          } catch (toolsError) {
            console.warn('[MCP Client] ⚠️ Impossibile listare tools:', toolsError.message);
          }

          return; // Successo, esci dal loop retry
          
        } catch (error) {
          lastError = error;
          console.error(`[MCP Client] ❌ Tentativo ${attempt} fallito:`, error.message);
          
          // Pulisci per prossimo tentativo
          if (this.client) {
            try {
              await this.client.close();
            } catch (closeError) {
              // Ignora errori di chiusura
            }
          }
          this.client = null;
          this.connected = false;

          // Attendi prima di ritentare (tranne all'ultimo tentativo)
          if (attempt < maxRetries) {
            const backoff = attempt * 1000;
            console.log(`[MCP Client] ⏳ Attendo ${backoff}ms prima di ritentare...`);
            await new Promise(resolve => setTimeout(resolve, backoff));
          }
        }
      }

      // Tutti i tentativi falliti
      console.error('[MCP Client] ❌ Tutti i tentativi di connessione falliti');
      throw lastError;
      
    })();

    try {
      await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  /**
   * Esegue una chiamata a una tool remota.
   */
  async callTool(name, args) {
    if (!this.connected) {
      console.log(`[MCP Client] 🔌 Non connesso, connetto prima di callTool ${name}...`);
      await this.connect();
    }

    try {
      console.log(`[MCP Client] 🔧 Chiamata tool: ${name}`);
      const result = await this.client.callTool({ name, arguments: args });
      console.log(`[MCP Client] ✅ Tool ${name} completato`);
      return result;
    } catch (error) {
      console.error(`[MCP Client] ❌ Errore tool ${name}:`, error);
      throw error;
    }
  }

  /**
   * Chiude la connessione MCP.
   */
  async disconnect() {
    if (this.client && this.connected) {
      console.log('[MCP Client] 🔌 Disconnessione...');
      try {
        await this.client.close();
        this.connected = false;
        console.log('[MCP Client] ✅ Disconnesso');
      } catch (error) {
        console.error('[MCP Client] ⚠️ Errore disconnessione:', error);
      }
    }
  }
}

export const mcpClient = new McpClientService();