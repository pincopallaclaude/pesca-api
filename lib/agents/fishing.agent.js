// /lib/agents/fishing.agent.js

/**
 * Fishing Agent (Zero-Cost ReACT)
 * - Max 3 iterazioni (vs infinito)
 * - Tool calling nativo Gemini (1 API call = N tool calls)
 * - Budget tracking per prevenire abuse
 */

import { generateContent } from '../services/gemini.service.js';
import { findSimilarEpisodes, getZoneStats } from '../db/memory.engine.js';
import { queryKnowledgeBase } from '../services/chromadb.service.js';
import { rerank } from '../services/reranker.service.js';
import logger from '../utils/logger.js';

// Tool definitions per Gemini Function Calling
const AVAILABLE_TOOLS = [
  {
    name: 'search_similar_sessions',
    description: 'Cerca sessioni di pesca simili nel passato con condizioni meteo comparabili',
    parameters: {
      type: 'object',
      properties: {
        conditions: {
          type: 'object',
          description: 'Condizioni meteo attuali da confrontare'
        },
        limit: {
          type: 'number',
          description: 'Numero di risultati da restituire',
          default: 5
        }
      },
      required: ['conditions']
    }
  },
  {
    name: 'get_zone_statistics',
    description: 'Ottieni statistiche aggregate sulla zona di pesca (successi passati, feedback medi)',
    parameters: {
      type: 'object',
      properties: {
        latitude: { type: 'number' },
        longitude: { type: 'number' },
        radius: { 
          type: 'number', 
          description: 'Raggio in gradi (0.1 = ~10km)',
          default: 0.1
        }
      },
      required: ['latitude', 'longitude']
    }
  },
  {
    name: 'search_knowledge_base',
    description: 'Cerca informazioni tecniche nella knowledge base (tecniche di pesca, comportamento specie, etc)',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query di ricerca in linguaggio naturale'
        },
        top_k: {
          type: 'number',
          default: 3
        }
      },
      required: ['query']
    }
  },
  {
    name: 'analyze_weather_trend',
    description: 'Analizza il trend meteo (es. pressione in calo, temperatura in aumento) per previsioni a breve termine',
    parameters: {
      type: 'object',
      properties: {
        hourly_data: {
          type: 'array',
          description: 'Array di dati orari con temperature, pressione, vento'
        }
      },
      required: ['hourly_data']
    }
  }
];

/**
 * Esegue un tool specifico
 */
async function executeTool(toolName, args) {
  logger.debug(`[Agent] Executing tool: ${toolName}`);
  
  try {
    switch (toolName) {
      case 'search_similar_sessions':
        return await findSimilarEpisodes(args.conditions, args.limit || 5);
      
      case 'get_zone_statistics':
        return getZoneStats(args.latitude, args.longitude, args.radius || 0.1);
      
      case 'search_knowledge_base':
        const results = await queryKnowledgeBase(args.query, args.top_k || 3);
        // Re-rank per maggior precisione
        const reranked = await rerank(args.query, results);
        return reranked.slice(0, args.top_k || 3);
      
      case 'analyze_weather_trend':
        return analyzeWeatherTrend(args.hourly_data);
      
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    logger.error(`[Agent] Tool execution failed: ${toolName}`, error);
    return { error: error.message };
  }
}

/**
 * Analisi trend meteo (tool interno)
 */
function analyzeWeatherTrend(hourlyData) {
  if (!hourlyData || hourlyData.length < 3) {
    return { trend: 'insufficient_data' };
  }
  
  // Calcola trend pressione
  const pressures = hourlyData.slice(0, 6).map(h => h.pressure);
  const pressureDelta = pressures[pressures.length - 1] - pressures[0];
  
  // Calcola trend temperatura
  const temps = hourlyData.slice(0, 6).map(h => h.temp);
  const tempDelta = temps[temps.length - 1] - temps[0];
  
  return {
    pressure_trend: pressureDelta < -2 ? 'falling' : pressureDelta > 2 ? 'rising' : 'stable',
    pressure_delta: pressureDelta,
    temp_trend: tempDelta < -1 ? 'cooling' : tempDelta > 1 ? 'warming' : 'stable',
    temp_delta: tempDelta,
    stability: Math.abs(pressureDelta) < 1 && Math.abs(tempDelta) < 0.5 ? 'high' : 'low'
  };
}

/**
 * Agent Loop con Budget
 */
export async function runFishingAgent(userQuery, context = {}) {
  const MAX_ITERATIONS = 3;
  const conversationHistory = [];
  
  // Initial system prompt
  const systemPrompt = `Sei un assistente esperto di pesca sportiva. 
Il tuo obiettivo è fornire analisi dettagliate e raccomandazioni basate su:
1. Condizioni meteo attuali
2. Esperienze passate in condizioni simili (memoria episodica)
3. Conoscenza tecnica della pesca (knowledge base)

Hai accesso a questi strumenti:
${AVAILABLE_TOOLS.map(t => `- ${t.name}: ${t.description}`).join('\n')}

Usa i tool in modo strategico per raccogliere informazioni prima di dare la tua risposta finale.
Quando hai raccolto abbastanza dati, fornisci una risposta completa e dettagliata senza chiamare altri tool.`;

  // Build initial query con contesto
  let currentQuery = `${userQuery}\n\nContesto meteo:\n${JSON.stringify(context, null, 2)}`;
  
  conversationHistory.push({
    role: 'user',
    parts: [{ text: currentQuery }]
  });
  
  // Agent loop
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    logger.info(`[Agent] Iteration ${iteration + 1}/${MAX_ITERATIONS}`);
    
    try {
      // Single API call con tool calling (Gemini native)
      const response = await generateContent({
        contents: conversationHistory,
        systemInstruction: systemPrompt,
        tools: [{ functionDeclarations: AVAILABLE_TOOLS }],
        maxTokens: 2048
      });
      
      const candidate = response.candidates[0];
      const content = candidate.content;
      
      // Aggiungi risposta model a history
      conversationHistory.push({
        role: 'model',
        parts: content.parts
      });
      
      // Check se ci sono tool calls
      const toolCalls = content.parts.filter(part => part.functionCall);
      
      if (toolCalls.length === 0) {
        // Nessun tool call → l'agente ha finito, estrai testo finale
        const textParts = content.parts.filter(part => part.text);
        const finalResponse = textParts.map(part => part.text).join('\n');
        
        logger.info(`[Agent] ✅ Completed in ${iteration + 1} iterations`);
        
        return {
          success: true,
          response: finalResponse,
          iterations: iteration + 1,
          tools_used: conversationHistory
            .flatMap(msg => msg.parts)
            .filter(part => part.functionCall)
            .map(part => part.functionCall.name)
        };
      }
      
      // Esegui tool calls in parallelo
      logger.debug(`[Agent] Executing ${toolCalls.length} tool calls`);
      
      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall) => {
          const { name, args } = toolCall.functionCall;
          const result = await executeTool(name, args);
          
          return {
            functionResponse: {
              name: name,
              response: result
            }
          };
        })
      );
      
      // Aggiungi tool results a history per prossima iterazione
      conversationHistory.push({
        role: 'user',
        parts: toolResults
      });
      
    } catch (error) {
      logger.error(`[Agent] Iteration ${iteration + 1} failed:`, error);
      
      // Graceful degradation
      if (iteration === 0) {
        throw error; // Fallisce subito se primo tentativo
      }
      
      // Altrimenti, usa l'ultima risposta parziale
      break;
    }
  }
  
  // Fallback se max iterations raggiunto
  logger.warn('[Agent] Max iterations reached, forcing final response');
  
  const finalResponse = await generateContent({
    contents: [
      ...conversationHistory,
      {
        role: 'user',
        parts: [{ text: 'Fornisci ora la tua analisi finale basata sui dati raccolti.' }]
      }
    ],
    systemInstruction: systemPrompt,
    tools: [], // No more tool calls
    maxTokens: 1024
  });
  
  const finalText = finalResponse.candidates[0].content.parts
    .filter(part => part.text)
    .map(part => part.text)
    .join('\n');
  
  return {
    success: true,
    response: finalText,
    iterations: MAX_ITERATIONS,
    tools_used: conversationHistory
      .flatMap(msg => msg.parts)
      .filter(part => part.functionCall)
      .map(part => part.functionCall.name),
    warning: 'max_iterations_reached'
  };
}

/**
 * Versione semplificata per analisi proattiva (no user query)
 */
export async function generateProactiveAnalysis(forecastData, location) {
  const context = {
    location: location,
    current_conditions: forecastData.hourly[0],
    daily_summary: forecastData.daily[0],
    pescaScore: forecastData.daily[0].pescaScore
  };
  
  const query = `Genera un'analisi dettagliata delle condizioni di pesca per oggi in questa località. 
Considera il pescaScore di ${context.pescaScore.score.toFixed(1)}, le condizioni meteo e marine, 
e cerca dati storici per confronti e raccomandazioni.`;
  
  return await runFishingAgent(query, context);
}