// /lib/agents/fishing.agent.js

/**
 * Fishing Agent (Zero-Cost ReACT) v2.1 - Hybrid Best-of-Both
 * - Sfrutta tool calling nativo Gemini (robusto)
 * - 4 tool completi (memoria + KB + stats + trend)
 * - Metadata tracking per monitoring
 * - Budget: max 3 iterazioni
 */

import { generateWithTools } from '../services/gemini.service.js';
import { findSimilarEpisodes, getZoneStats } from '../db/memory.engine.js';
import { queryKnowledgeBase } from '../services/chromadb.service.js';
import { rerankDocuments } from '../services/reranker.service.js';
import * as logger from '../utils/logger.js';

// === TOOL DEFINITIONS (Completi - 4 Tool) ===
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
  },
  {
    name: 'analyze_weather_trend',
    description: 'Analizza i trend meteo nelle prossime ore (pressione in calo/aumento, temperatura, stabilità) per previsioni a breve termine.',
    parameters: {
      type: 'object',
      properties: {
        hourly_data: {
          type: 'array',
          description: 'Array di oggetti con dati orari (temp, pressure, wind, etc).',
          items: { // --- AGGIUNTO BLOCCO 'items' ---
            type: 'object',
            properties: {
              temp: { type: 'number' },
              pressure: { type: 'number' },
              wind: { type: 'number' }
            }
          }
        }
      },
      required: ['hourly_data']
    }
  }
];

// === TOOL EXECUTION ===
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
      
      case 'analyze_weather_trend':
        result = analyzeWeatherTrend(args.hourly_data);
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

// === WEATHER TREND ANALYZER (Tool Interno) ===
function analyzeWeatherTrend(hourlyData) {
  if (!hourlyData || hourlyData.length < 3) {
    return { 
      trend: 'insufficient_data',
      message: 'Servono almeno 3 ore di dati per analisi trend'
    };
  }
  
  // Analizza pressione nelle prossime 6 ore
  const pressures = hourlyData.slice(0, 6).map(h => h.pressure).filter(p => p != null);
  const pressureDelta = pressures.length >= 2 
    ? pressures[pressures.length - 1] - pressures[0]
    : 0;
  
  // Analizza temperatura
  const temps = hourlyData.slice(0, 6).map(h => h.temp).filter(t => t != null);
  const tempDelta = temps.length >= 2
    ? temps[temps.length - 1] - temps[0]
    : 0;
  
  // Calcola stabilità generale
  const pressureStable = Math.abs(pressureDelta) < 1;
  const tempStable = Math.abs(tempDelta) < 0.5;
  
  return {
    pressure_trend: pressureDelta < -2 ? 'falling' : pressureDelta > 2 ? 'rising' : 'stable',
    pressure_delta_hpa: pressureDelta.toFixed(1),
    temp_trend: tempDelta < -1 ? 'cooling' : tempDelta > 1 ? 'warming' : 'stable',
    temp_delta_celsius: tempDelta.toFixed(1),
    stability: pressureStable && tempStable ? 'high' : 'low',
    forecast_quality: pressureStable ? 'conditions_stable' : 'conditions_changing',
    hours_analyzed: Math.min(hourlyData.length, 6)
  };
}

// === AGENT ORCHESTRATOR (con Metadata Tracking) ===  
export async function runFishingAgent(userQuery, context = {}) {
  const startTime = Date.now();
  const MAX_ITERATIONS = 3;
  const conversationHistory = [];
  const toolsUsed = []; // Track per monitoring    
  
  logger.log(`[Agent] 🎯 Starting agent for query: "${userQuery.substring(0, 60)}..."`);
  
  const systemPrompt = `Sei un assistente esperto di pesca sportiva. 
Il tuo compito è rispondere alla domanda dell'utente usando gli strumenti a tua disposizione.

STRATEGIA:
1. Analizza la domanda e identifica quali dati ti servono
2. Usa gli strumenti in modo strategico per raccogliere informazioni
3. Combina i dati raccolti con la tua conoscenza per dare una risposta completa e dettagliata
4. Quando hai abbastanza informazioni, fornisci la risposta finale SENZA chiamare altri tool

IMPORTANTE: Sii specifico, usa dati concreti, e fornisci raccomandazioni pratiche.`;

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
      // Call Gemini con tool calling nativo
      const candidate = await generateWithTools({
        contents: conversationHistory,
        systemInstruction: { parts: [{ text: systemPrompt }] },
        tools: [{ functionDeclarations: AVAILABLE_TOOLS }]
      });
      
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
  
  const context = {
    location: location,
    // forecastData è GIÀ il daily summary che ci serve.
    // 'hourly' è una chiave dentro di esso.
    daily_summary: forecastData, 
    current_conditions: forecastData.hourly[0], // CORREZIONE: la chiave è 'hourly'
    pescaScore: forecastData.pescaScoreData,
    hourly_forecast: forecastData.hourly.slice(0, 6) // CORREZIONE: la chiave è 'hourly'
  };
  
const query = `Genera un'analisi dettagliata delle condizioni di pesca per oggi in ${location.name}. 
  
ELEMENTI DA CONSIDERARE:
- PescaScore attuale: ${context.pescaScore.numericScore.toFixed(1)}/10
- Condizioni meteo e marine attuali
- Trend previsti nelle prossime ore
- Dati storici della zona (se disponibili)
- Raccomandazioni pratiche (tecniche, esche, orari migliori)

Fornisci un'analisi completa, specifica e ricca di dettagli pratici.`;
  
  return await runFishingAgent(query, context);
}

// === EXPORTS ===
export { executeToolCall, analyzeWeatherTrend};