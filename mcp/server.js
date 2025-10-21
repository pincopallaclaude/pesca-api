// /mcp/server.js

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Importa i gestori dei tool
import { vectorSearch } from './tools/vector-search.js';
import { generateAnalysis } from './tools/generate-analysis.js';
import { getFishingInsight } from './tools/get-insight.js';

// Importa il gestore della resource
import { getKnowledgeBase } from './resources/knowledge-base.js';
import { vectorService } from '../lib/services/vector.service.js';

class RagMcpServer {
  constructor() {
    this.server = new Server(
      { name: 'pesca-rag-server', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {} } }
    );

    this.setupToolHandlers();
    this.setupResourceHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'vector_search',
          description: 'Cerca documenti rilevanti nella knowledge base vettorializzata.',
          inputSchema: { type: 'object', properties: { query: { type: 'string' }, topK: { type: 'number', default: 5 } }, required: ['query'] },
        },
        {
          name: 'generate_analysis',
          description: 'Genera un\'analisi di pesca completa usando RAG.',
          inputSchema: { type: 'object', properties: { weatherData: { type: 'object' }, location: { type: 'string' } }, required: ['weatherData', 'location'] },
        },
        {
          name: 'get_fishing_insight',
          description: 'Ottiene un insight specifico su un argomento di pesca.',
          inputSchema: { type: 'object', properties: { topic: { type: 'string' }, context: { type: 'object' } }, required: ['topic'] },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        switch (name) {
          case 'vector_search': return await vectorSearch(args);
          case 'generate_analysis': return await generateAnalysis(args);
          case 'get_fishing_insight': return await getFishingInsight(args);
          default: throw new Error(`Tool sconosciuto: ${name}`);
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Errore nell'esecuzione del tool ${name}: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  setupResourceHandlers() {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'kb://fishing/knowledge_base',
          name: 'Knowledge Base Pesca',
          description: 'Database vettoriale di tecniche, specie ed esche.',
          mimeType: 'application/json',
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      if (request.params.uri === 'kb://fishing/knowledge_base') {
        const kb = await getKnowledgeBase();
        return {
          contents: [{
            uri: request.params.uri,
            mimeType: 'application/json',
            text: JSON.stringify(kb, null, 2),
          }],
        };
      }
      throw new Error(`Resource non trovata: ${request.params.uri}`);
    });
  }

  async start() {
    try {
        // Carica la KB in memoria prima di avviare il server
        vectorService.loadKnowledgeBaseFromFile();
        
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.log('🎣 MCP RAG Server avviato (modalità embedded).');
    } catch (error) {
        console.error('❌ Fallimento avvio MCP Server:', error);
        process.exit(1); // Esce se il server non può partire
    }
  }
}

// Avvia il server quando questo file viene eseguito come script principale
const server = new RagMcpServer();
server.start();

export default RagMcpServer;