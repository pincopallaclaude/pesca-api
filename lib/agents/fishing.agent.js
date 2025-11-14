// /lib/agents/fishing.agent.js

/**
 * Fishing Agent (Agente di Pesca)
 * Implementa un Agent Loop per raccogliere dati storici, di zona e marini (Tools)
 * prima di richiedere la strategia finale a Gemini.
 */
import { generateWithTools } from '../services/gemini.service.js'; // Assumo che usi questa API di wrapper
import { findSimilarEpisodes, getZoneStats } from '../db/memory.engine.js';
import { queryKnowledgeBase } from '../services/chromadb.service.js';
import { rerankDocuments } from '../services/reranker.service.js';
import * as marineService from '../services/marine.service.js'; // NUOVO: Import del Marine Service
import * as logger from '../utils/logger.js';
import { formatTime } from '../utils/formatter.js'; // Aggiunto per il contesto di analisi

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
        name: 'get_marine_forecast', // NUOVO TOOL
        description: 'Recupera dati oceanografici specifici come temperatura dell\'acqua, altezza delle onde e velocità della corrente marina.',
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
            },
            required: ['latitude', 'longitude']
        }
    }
];

/**
 * Esegue la chiamata al tool richiesto dall'Agente.
 * @param {Object} functionCall - Oggetto functionCall dall'API di Gemini.
 * @returns {Object} Oggetto functionResponse da inviare indietro all'LLM.
 */
async function executeToolCall(functionCall) {
    const { name, args } = functionCall;
    logger.log(`[Agent] 🔧 Executing tool: ${name}`);
    
    try {
        let result;
        switch (name) {
            case 'search_similar_episodes':
                result = await findSimilarEpisodes(args.currentConditions, args.limit || 5);
                break;
            case 'get_zone_statistics':
                result = await getZoneStats(args.latitude, args.longitude, args.radius || 0.1); 
                break;
            case 'search_knowledge_base':
                const rawResults = await queryKnowledgeBase(args.query, args.top_k || 5);
                if (typeof rerankDocuments === 'function') {
                    result = await rerankDocuments(args.query, rawResults);
                } else {
                    result = rawResults;
                }
                break;
            case 'get_marine_forecast': // NUOVA LOGICA TOOL
                result = await marineService.fetchMarineData(args.latitude, args.longitude);
                break;
            default:
                result = { error: `Tool sconosciuto: ${name}` };
        }
        
        logger.log(`[Agent] ✅ Tool ${name} completed`);
        // Uniformo il formato di ritorno per la funzione di esecuzione del tool.
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

/**
 * Funzione principale che esegue il loop di Tool Calling per l'Agente P.H.A.N.T.O.M.
 */
export async function runFishingAgent(userQuery, context = {}) {
    const startTime = Date.now();
    const MAX_ITERATIONS = 4; // Aumento le iterazioni a 4 per dare più spazio all'LLM se usa tutti i tool
    const conversationHistory = [];
    const toolsUsed = [];
    
    logger.log(`[Agent] 🎯 Starting agent for query: "${userQuery.substring(0, 60)}..."`);
    
    const systemPrompt = `Sei un Agente AI esperto di pesca (P.H.A.N.T.O.M.).
Rispondi all'utente usando gli strumenti forniti e il contesto.

STRATEGIA:
1. Usa gli strumenti (search_similar_episodes, get_zone_statistics, get_marine_forecast, search_knowledge_base) per raccogliere dati.
2. Analizza e combina i dati raccolti con le informazioni meteo/marine già presenti nel Contesto iniziale.
3. Fornisci un'analisi finale completa e dettagliata con raccomandazioni pratiche.
4. Concludi sempre con una risposta testuale in formato report (senza markdown) in ITALIANO.

CONTESTO INIZIALE:
${JSON.stringify(context, null, 2)}`; // Aggiungo il contesto qui per rafforzare il grounding
    
    const initialPrompt = `Domanda: ${userQuery}`;
    
    conversationHistory.push({
        role: 'user',
        parts: [{ text: initialPrompt }]
    });
    
    let toolCalls = [];
    
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
        logger.log(`[Agent] 📍 Iteration ${iteration + 1}/${MAX_ITERATIONS}`);
        
        try {
            if (iteration === 0) {
                // === FORZATURA TOOL CALL PER ANALISI PROATTIVA (Bypass Lazy Agent) ===
                // Garantisce che i dati essenziali (statistiche, memoria e mari) vengano raccolti subito.
                logger.log('[Agent] 🧠 FORCING essential tool calls in Iteration 1.');
                
                // Uso i dati dal contesto per gli argomenti dei tool
                toolCalls = [
                    {
                        name: 'search_similar_episodes',
                        args: { currentConditions: context }
                    },
                    {
                        name: 'get_zone_statistics',
                        args: { 
                            latitude: context.location.lat, 
                            longitude: context.location.lon, 
                            radius: 0.1 
                        }
                    },
                    {
                        name: 'get_marine_forecast', // NUOVO TOOL FORZATO
                        args: { 
                            latitude: context.location.lat, 
                            longitude: context.location.lon
                        }
                    }
                ];
                
            } else {
                // Iterazioni successive: lasciano che l'LLM decida
                const candidate = await generateWithTools({
                    contents: conversationHistory,
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    tools: AVAILABLE_TOOLS.map(t => ({ functionDeclarations: [t] }))
                });
                
                if (!candidate || !candidate.content) {
                    logger.warn('[Agent] Empty response from Gemini, breaking loop');
                    break;
                }
                
                const content = candidate.content;
                conversationHistory.push(content);
                
                // Se c'è testo nella risposta, l'agente ha terminato il ragionamento
                if (content.parts.some(p => p.text) && content.parts.filter(p => p.text).join('').trim().length > 0) {
                    logger.log('[Agent] Final textual response received from model.');
                    break;
                }
                
                // Altrimenti, cerca tool calls
                toolCalls = content.parts
                    .filter(part => part.functionCall)
                    .map(part => part.functionCall);
            }
            
            // Controlla se ci sono tool da eseguire
            if (toolCalls.length === 0) {
                // Se non ci sono tool calls e non c'era testo (vedi break sopra), l'agente ha finito
                logger.log(`[Agent] ✅ Agent completed in ${iteration + 1} iterations (no tool calls).`);
                break; 
            }
            
            // Execute tool calls
            logger.log(`[Agent] Executing ${toolCalls.length} tool(s)`);
            
            // Esegui i tool in parallelo
            const toolResults = await Promise.all(
                toolCalls.map(async (call) => {
                    toolsUsed.push(call.name); // Track usage
                    return await executeToolCall(call);
                })
            );
            
            // Add tool results to history for next iteration
            conversationHistory.push({
                role: 'function',
                parts: toolResults.map(r => r.functionResponse) // Mappiamo solo functionResponse
            });

            // Se eravamo nell'iterazione 0 forzata, l'LLM deve eseguire il Ragionamento nell'Iterazione 2
            if (iteration === 0) {
                logger.log('[Agent] ↪️ Forcing next iteration (Iteration 2) for LLM Reasoning.');
                continue;
            }
            
        } catch (error) {
            logger.error(`[Agent] ❌ Iteration ${iteration + 1} failed:`, error);
            if (iteration === 0) {
                // Se fallisce l'iterazione 0 forzata, fermiamo tutto
                return {
                    success: false,
                    response: `Si è verificato un errore critico durante la raccolta iniziale dei dati: ${error.message}`,
                    iterations: 1,
                    tools_used: toolsUsed,
                    execution_time_ms: Date.now() - startTime
                };
            }
            break;
        }
    }
    
    // === EXTRACT FINAL RESPONSE ===
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    let finalResponse = '';
    
    // Se l'ultima cosa in history non è un testo finale, forza la generazione finale
    if (lastMessage.role !== 'model' || lastMessage.parts.some(p => p.functionResponse || p.functionCall)) {
        
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
            tools: [] // Nessun altro tool
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
        iterations: conversationHistory.filter(m => m.role === 'model').length, // Numero di volte che l'LLM ha ragionato
        tools_used: toolsUsed,
        execution_time_ms: executionTime,
        tokens_estimated: conversationHistory.length * 500 // Stima grezza
    };
}

// === PROACTIVE ANALYSIS WRAPPER (per P.H.A.N.T.O.M.) ===

/**
 * Prepara il contesto e lancia l'Agente P.H.A.N.T.O.M. per un'analisi proattiva.
 * @param {Object} forecastData - Dati del forecast del primo giorno.
 * @param {Object} location - Oggetto località {name, lat, lon}.
 */
export async function generateProactiveAnalysis(forecastData, location) {
    logger.log(`[Agent] 🤖 Starting proactive analysis for ${location.name}`);
    
    const context = {
        location: location,
        daily_summary: forecastData, 
        current_conditions: forecastData.hourly[0], 
        pescaScore: forecastData.pescaScoreData,
        // Formatta l'ora per una migliore leggibilità nel prompt di sistema
        hourly_forecast: forecastData.hourly.slice(0, 6).map(hour => ({
            time: formatTime(hour.time), 
            ...hour 
        }))
    };
    
    // Query forzata che scatenerà il Tool Forcing nella prima iterazione di runFishingAgent
    const query = `Genera un'analisi dettagliata delle condizioni di pesca per oggi in ${location.name}. 
    
ELEMENTI DA CONSIDERARE:
- PescaScore attuale: ${context.pescaScore.numericScore.toFixed(1)}/10
- Condizioni meteo e marine attuali
- Trend previsti nelle prossime ore (analizza i dati in hourly_forecast)
- Dati storici della zona (se disponibili)
- Raccomandazioni pratiche (tecniche, esche, orari migliori)

Fornisci un'analisi completa, specifica e ricca di dettagli pratici.`;
    
    return await runFishingAgent(query, context);
}

export { executeToolCall };