// /mcp/server.js

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Import tools
import { vectorSearch } from './tools/vector-search.js';
import { generateAnalysis } from './tools/generate-analysis.js';
import { getKnowledgeBase } from './resources/knowledge-base.js';

// ==========================================
// HELPER: Log su stderr invece di stdout
// (stdout è riservato al protocollo MCP JSON)
// ==========================================
function serverLog(...args) {
  console.error(...args);
}

/**
 * Server MCP dedicato al RAG (Retrieval-Augmented Generation)
 */
class RagMcpServer {
  constructor() {
    serverLog('[MCP Server] 🏗️ Costruttore - Inizializzazione...');
    
    try {
      this.server = new Server(
        { 
          name: 'pesca-rag-server', 
          version: '1.0.0' 
        },
        { 
          capabilities: { 
            tools: {}, 
            resources: {} 
          } 
        }
      );
      
      serverLog('[MCP Server] ✅ Server SDK istanziato');
      this.setupHandlers();
      serverLog('[MCP Server] ✅ Handlers configurati');
      
    } catch (error) {
      serverLog('[MCP Server] ❌ Errore costruttore:', error);
      throw error;
    }
  }

  setupHandlers() {
    // --- 1. Lista Tools ---
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      serverLog('[MCP Server] 📋 ListTools richiesto');
      return {
        tools: [
          {
            name: 'vector_search',
            description: 'Cerca documenti nella knowledge base vettoriale',
            inputSchema: {
              type: 'object',
              properties: {
                query: { 
                  type: 'string', 
                  description: 'Query semantica' 
                },
                topK: { 
                  type: 'number', 
                  default: 5 
                }
              },
              required: ['query']
            }
          },
          {
            name: 'generate_analysis',
            description: 'Genera analisi pesca completa con RAG',
            inputSchema: {
              type: 'object',
              properties: {
                weatherData: { 
                  type: 'object', 
                  description: 'Dati meteo-marini' 
                },
                location: { 
                  type: 'string', 
                  description: 'Nome località' 
                }
              },
              required: ['weatherData', 'location']
            }
          }
        ]
      };
    });

    // --- 2. Esecuzione Tools ---
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      serverLog(`[MCP Server] 🔧 CallTool: ${name}`);
      
      try {
        switch (name) {
          case 'vector_search':
            return await vectorSearch(args);
          case 'generate_analysis':
            return await generateAnalysis(args);
          default:
            throw new Error(`Tool sconosciuto: ${name}`);
        }
      } catch (error) {
        serverLog(`[MCP Server] ❌ Errore tool ${name}:`, error);
        return {
          content: [{ 
            type: 'text', 
            text: `Errore: ${error.message}` 
          }],
          isError: true
        };
      }
    });

    // --- 3. Lista Resources ---
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      serverLog('[MCP Server] 📋 ListResources richiesto');
      return {
        resources: [{
          uri: 'kb://fishing/knowledge_base',
          name: 'Knowledge Base Pesca',
          mimeType: 'application/json'
        }]
      };
    });

    // --- 4. Lettura Resources ---
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;
      serverLog(`[MCP Server] 📖 ReadResource: ${uri}`);
      
      if (uri === 'kb://fishing/knowledge_base') {
        const kb = await getKnowledgeBase();
        return {
          contents: [{
            uri: uri,
            mimeType: 'application/json',
            text: JSON.stringify(kb, null, 2)
          }]
        };
      }
      
      throw new Error(`Resource non trovata: ${uri}`);
    });
  }

  async start() {
    try {
      serverLog('[MCP Server] 🚀 Avvio transport stdio...');
      const transport = new StdioServerTransport();
      
      await this.server.connect(transport);
      serverLog('[MCP Server] ✅ Server connesso e pronto');
      
    } catch (error) {
      serverLog('[MCP Server] ❌ Errore start:', error);
      throw error;
    }
  }
}

// ==========================================
// AUTO-AVVIO SE ESEGUITO DIRETTAMENTE
// ==========================================

// Normalizza path per Windows/Unix
const currentFilePath = import.meta.url.replace('file:///', '').replace(/\//g, '\\');
const argv1 = process.argv[1].replace(/\//g, '\\');

if (currentFilePath.endsWith(argv1) || argv1.endsWith('mcp\\server.js')) {
  serverLog('[MCP Server] ✅ Esecuzione diretta rilevata');
  serverLog('[MCP Server] 🚀 Avvio standalone...');
  
  const server = new RagMcpServer();
  server.start()
    .then(() => {
      serverLog('[MCP Server] ✅ Server pronto e in ascolto su stdio');
      serverLog('[MCP Server] 💡 Premi Ctrl+C per terminare');
    })
    .catch(error => {
      serverLog('[MCP Server] ❌ Errore fatale:', error);
      process.exit(1);
    });
}

export default RagMcpServer;