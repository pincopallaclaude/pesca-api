// /lib/agents/fishing.agent.js

/**
 * Fishing Agent (Zero-Cost ReACT) v2.1 - Hybrid Best-of-Both
 * - Sfrutta tool calling nativo Gemini (robusto)
 * - 3 tool essenziali (memoria + KB + stats)
 * - Metadata tracking per monitoring
 * - Budget: max 3 iterazioni
 */

import { generateWithTools } from '../services/gemini.service.js';
import { findSimilarEpisodes, getZoneStats } from '../db/memory.engine.js';
import { queryKnowledgeBase } from '../services/chromadb.service.js';
import { rerankDocuments } from '../services/reranker.service.js';
import * as logger from '../utils/logger.js';

// === TOOL DEFINITIONS (3 Tool Essenziali) ===
const AVAILABLE_TOOLS = [
  {
    name: 'search_similar_episodes',
    description: 'Cerca nella memoria episodi di pesca passati con condizioni meteo/marine simili per trovare pattern e analogie utili.',
    parameters: {
      type: 'object',
      properties: {
        currentConditions: {
          type: 'object',
          description: 'Oggetto con le condizioni attuali (location, weatherData, pescaScore).'
        },
        limit: {
          type: 'number',
          description: 'Numero massimo di episodi da recuperare.',
          default: 5
        }
      },
      required: ['currentConditions']
    }
  },
  {
    name: 'get_zone_statistics',
    description: 'Ottieni statistiche aggregate sulla zona di pesca (feedback medi, successi storici, sample count) per capire la produttività della zona.',
    parameters: {
      type: 'object',
      properties: {
        latitude: {
          type: 'number',
          description: 'Latitudine della zona da analizzare.'
        },
        longitude: {
          type: 'number',
          description: 'Longitudine della zona da analizzare.'
        },
        radius: {
          type: 'number',
          description: 'Raggio in gradi (0.1 = ~10km).',
          default: 0.1
        }
      },
      required: ['latitude', 'longitude']
    }
  },
  {
    name: 'search_knowledge_base',
    description: 'Cerca informazioni tecniche nella knowledge base (tecniche di pesca, esche, comportamento specie, regolamentazioni).',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Query di ricerca in linguaggio naturale.'
        },
        top_k: {
          type: 'number',
          description: 'Numero di documenti da recuperare.',
          default: 3
        }
      },
      required: ['query']
    }
  }
];

// === TOOL EXECUTION (Rimossa la gestione di analyze_weather_trend) ===
async function executeToolCall(functionCall) {
  const { name, args } = functionCall;
  logger.log(`[Agent] 🔧 Executing tool: ${name}`);
  
  try {
    let result;
    
    switch (name) {
      case 'search_similar_episodes':
        result = await findSimilarEpisodes(
          args.currentConditions, 
          args.limit || 5
        );
        break;
      
      case 'get_zone_statistics':
        result = getZoneStats(
          args.latitude, 
          args.longitude, 
          args.radius || 0.1
        );
        break;
      
      case 'search_knowledge_base':
        const rawResults = await queryKnowledgeBase(args.query, args.top_k || 5);
        // Re-ranking opzionale per maggior precisione
        if (rerankDocuments) {
          result = await rerankDocuments(args.query, rawResults);
        } else {
          result = rawResults;
        }
        break;
      
      default:
        result = { error: `Tool sconosciuto: ${name}` };
    }
    
    logger.log(`[Agent] ✅ Tool ${name} completed`);
    
    return {
      functionResponse: {
        name: name,
        response: { result: result }
      }
    };
    
  } catch (error) {
    logger.error(`[Agent] ❌ Tool ${name} failed:`, error);
    return {
      functionResponse: {
        name: name,
        response: { error: error.message }
      }
    };
  }
}

// === AGENT ORCHESTRATOR (con Metadata Tracking) ===  
export async function runFishingAgent(userQuery, context = {}) {
  const startTime = Date.now();
  const MAX_ITERATIONS = 3;
  const conversationHistory = [];
  const toolsUsed = []; // Track per monitoring    
  
  logger.log(`[Agent] 🎯 Starting agent for query: "${userQuery.substring(0, 60)}..."`);
  
  const systemPrompt = `Sei un Agente AI esperto di pesca.
Rispondi all'utente usando gli strumenti forniti e il contesto.

STRATEGIA:
1. Usa gli strumenti (search_similar_episodes, get_zone_statistics, search_knowledge_base) per raccogliere dati.
2. Analizza i trend meteo (visibili nel contesto) e combina con i dati dei tool.
3. Fornisci un'analisi finale completa e dettagliata con raccomandazioni pratiche.
4. Concludi sempre con una risposta testuale.`;

  // Build initial query con contesto
  const initialPrompt = `Contesto meteo e condizioni:\n${JSON.stringify(context, null, 2)}\n\nDomanda: ${userQuery}`;
  
  conversationHistory.push({
    role: 'user',
    parts: [{ text: initialPrompt }]
  });
  
  // === REACT LOOP ===
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      logger.log(`[Agent] 📍 Iteration ${iteration + 1}/${MAX_ITERATIONS}`);
      
      try {
        // MODIFICA ESTREMA: Rimuoviamo l'intera proprietà 'tools'
        // solo nella prima iterazione per vedere se la sua sola presenza causa il 503.
        const requestParams = {
          contents: conversationHistory,
          systemInstruction: { parts: [{ text: systemPrompt }] },
        };
        
        if (iteration > 0) {
          // Dalla seconda iterazione in poi, riabilitiamo i tool
          requestParams.tools = [{ functionDeclarations: AVAILABLE_TOOLS }];
        }

        // 🛑 LOGGING AGGIUNTO PER ROOT CAUSE ANALYSIS 🛑
        const payloadString = JSON.stringify(requestParams);
        const payloadBytes = new TextEncoder().encode(payloadString).length;
        
        logger.info(`[Gemini-DEBUG] Payload Size: ${payloadBytes} bytes`);
        logger.debug(`[Gemini-DEBUG] Request Head: ${payloadString.substring(0, 500)}...`);
        
        // Call Gemini con parametri dinamici
        const candidate = await generateWithTools(requestParams);
      
      if (!candidate || !candidate.content) {
        logger.warn('[Agent] Empty response from Gemini, breaking loop');
        break;
      }
      
      const content = candidate.content;
      conversationHistory.push(content); // Add model response to history
      
      // Extract tool calls (se presenti)
      const toolCalls = content.parts
        .filter(part => part.functionCall)
        .map(part => part.functionCall);
      
      if (toolCalls.length === 0) {
        // No tool calls → agent is done
        logger.log(`[Agent] ✅ Agent completed in ${iteration + 1} iterations`);
        break;
      }
      
      // Execute tool calls
      logger.log(`[Agent] Executing ${toolCalls.length} tool(s)`);
      
      const toolResults = await Promise.all(
        toolCalls.map(async (call) => {
          toolsUsed.push(call.name); // Track usage
          return await executeToolCall(call);
        })
      );
      
      // Add tool results to history for next iteration
      conversationHistory.push({
        role: 'function',
        parts: toolResults
      });
      
    } catch (error) {
      logger.error(`[Agent] ❌ Iteration ${iteration + 1} failed:`, error);
      
      // Graceful degradation
      if (iteration === 0) {
        throw error; // Fail fast on first iteration
      }
      break; // Use partial response
    }
  }
  
  // === EXTRACT FINAL RESPONSE ===
  const lastMessage = conversationHistory[conversationHistory.length - 1];
  let finalResponse = '';
  
  // Se l'ultimo messaggio è una tool call, forza risposta finale
  if (lastMessage.role === 'function' || 
      (lastMessage.role === 'model' && lastMessage.parts.some(p => p.functionCall))) {
    
    logger.log('[Agent] Forcing final response generation...');
    
    const finalCandidate = await generateWithTools({
      contents: [
        ...conversationHistory,
        {
          role: 'user',
          parts: [{
            text: 'Basandoti su tutti i dati raccolti, formula ora la tua analisi finale completa e dettagliata.'
          }]
        }
      ],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      tools: [] // No more tool calls
    });
    
    if (finalCandidate?.content?.parts) {
      finalResponse = finalCandidate.content.parts
        .filter(p => p.text)
        .map(p => p.text)
        .join('')
        .trim();
    }
  } else {
    // L'ultima risposta del modello è già la finale
    finalResponse = lastMessage.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join('')
      .trim();
  }
  
  const executionTime = Date.now() - startTime;
  
  // Fallback se nessuna risposta
  if (!finalResponse) {
    logger.error('[Agent] ❌ No final response generated');
    finalResponse = 'Mi dispiace, non sono riuscito a elaborare una risposta. Riprova.';
  }
  
  logger.log(`[Agent] ✅ Total execution time: ${executionTime}ms`);
  
  // === RETURN CON METADATA (per monitoring) ===
  return {
    success: true,
    response: finalResponse,
    iterations: Math.min(conversationHistory.filter(m => m.role === 'model').length, MAX_ITERATIONS),
    tools_used: toolsUsed,
    execution_time_ms: executionTime,
    tokens_estimated: conversationHistory.length * 500 // Rough estimate
  };
}

// === PROACTIVE ANALYSIS WRAPPER (per P.H.A.N.T.O.M.) ===
export async function generateProactiveAnalysis(forecastData, location) {
  logger.log(`[Agent] 🤖 Starting proactive analysis for ${location.name}`);
  
  // Nuovi Controlli di sicurezza per prevenire i TypeError
  const dailyData = forecastData.daily || [];
  const currentDayData = dailyData[0] || { pescaScore: { score: 0, rating: 'unknown' }, weather: 'N/D' };
  
  const hourlyData = forecastData.hourly || [];
  const currentHourData = hourlyData[0] || {};
  
  // Contesto ultra-snello con dati essenziali per l'analisi nativa del trend (max 6h)
  const trend_6h_data = hourlyData.slice(0, 6);
  const firstHour = trend_6h_data[0] || {};
  const sixthHour = trend_6h_data[5] || trend_6h_data[trend_6h_data.length - 1] || {};

  // Context per prompt iniziale (estratto i dati solo se esistono)
  const context = {
    location: {
      name: location.name,
      lat: location.lat,
      lon: location.lon
    },
    oggi: {
      pescaScore: currentDayData.pescaScore.score.toFixed(1),
      rating: currentDayData.pescaScore.rating,
      meteo: currentDayData.weather || 'variabile',
      vento: `${currentHourData.wind || 'N/D'} km/h ${currentHourData.windDir || ''}`,
      mare: `${currentHourData.waveHeight || 'N/D'}m`,
      temp_acqua: `${currentHourData.waterTemp || 'N/D'}°C`
    },
    // Trend orario essenziale per analisi nativa di Gemini (no tool necessario)
    trend_6h: {
      pressione: `${firstHour.pressure || 'N/D'} → ${sixthHour.pressure || 'N/D'} hPa`,
      temperatura: `${firstHour.temp || 'N/D'} → ${sixthHour.temp || 'N/D'}°C`,
      vento: `${firstHour.wind || 'N/D'} → ${sixthHour.wind || 'N/D'} km/h`
    }
  };
  
  // Query SNELLA
  const query = `Analizza le condizioni di pesca per oggi a ${location.name}.

📊 SITUAZIONE ATTUALE:
- PescaScore: ${context.oggi.pescaScore}/10 (${context.oggi.rating})
- Meteo: ${context.oggi.meteo}
- Vento: ${context.oggi.vento}
- Mare: ${context.oggi.mare}
- Temp. Acqua: ${context.oggi.temp_acqua}

📈 TREND 6 ORE:
- Pressione: ${context.trend_6h.pressione}
- Temperatura: ${context.trend_6h.temperatura}
- Vento: ${context.trend_6h.vento}

🎯 COMPITO:
1. Analizza i trend sopra (pressione in calo/aumento? condizioni stabili?)
2. USA I TOOL per arricchire l'analisi:
   - search_similar_episodes: Confronta con episodi passati simili
   - get_zone_statistics: Verifica produttività storica della zona
   - search_knowledge_base: Trova tecniche/esche consigliate

3. Fornisci analisi COMPLETA e DETTAGLIATA con:
   - Valutazione condizioni attuali e trend
   - Confronto con dati storici (se disponibili)
   - Orari migliori per pescare oggi
   - Tecniche e esche consigliate
   - Specie target più probabili

IMPORTANTE: Sii specifico, pratico e usa dati concreti dai tool.`;
  
  return await runFishingAgent(query, context);
}

// === EXPORTS ===
export { executeToolCall };