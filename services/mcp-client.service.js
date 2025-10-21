// /services/mcp-client.service.js

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class McpClientService {
  constructor() {
    this.client = null;
    this.connected = false;
    this.connectionPromise = null; // Previene race conditions sulla connessione
  }

  async connect() {
    if (this.connected) return;
    if (this.connectionPromise) return this.connectionPromise;

    this.connectionPromise = (async () => {
      try {
        this.client = new Client({ name: 'pesca-api-client', version: '1.0.0' }, { capabilities: {} });

        // Il path deve puntare al file del server MCP
        const serverScriptPath = path.join(__dirname, '..', 'mcp', 'server.js');
        
        const transport = new StdioClientTransport({
          command: 'node',
          args: [serverScriptPath],
        });

        await this.client.connect(transport);
        this.connected = true;
        console.log('✅ MCP Client connesso al server embedded.');
      } catch (error) {
        console.error('❌ Errore di connessione MCP:', error);
        this.connectionPromise = null; // Resetta la promise in caso di fallimento
        throw error;
      }
    })();

    return this.connectionPromise;
  }

  async callTool(name, args) {
    if (!this.connected) await this.connect();
    try {
      const result = await this.client.callTool({ name, arguments: args });
      if (result.isError) {
          throw new Error(result.content[0].text);
      }
      return result;
    } catch (error) {
      console.error(`❌ Errore chiamata tool ${name}:`, error);
      throw error;
    }
  }

  async readResource(uri) {
    if (!this.connected) await this.connect();
    try {
      return await this.client.readResource({ uri });
    } catch (error) {
      console.error(`❌ Errore lettura resource ${uri}:`, error);
      throw error;
    }
  }
  
  async listTools() {
    if (!this.connected) await this.connect();
    const result = await this.client.listTools();
    return result.tools;
  }

  async disconnect() {
    if (this.client && this.connected) {
      await this.client.close();
      this.connected = false;
      this.client = null;
      console.log('🔌 MCP Client disconnesso.');
    }
  }
}

export const mcpClient = new McpClientService();