// /lib/agents/fishing.agent.js

/**
 * Fishing Agent (Zero-Cost ReACT) v2.0 - Corretto e Funzionante
 * - Max 3 iterazioni (vs infinito)
 * - Tool calling nativo Gemini (1 API call = N tool calls)
 * - Budget tracking per prevenire abuse
 */

// NOTA: Importiamo SOLO 'generateWithTools' dal nostro servizio potenziato
import { generateWithTools } from '../services/gemini.service.js'; 
import { findSimilarEpisodes } from '../db/memory.engine.js';
import { queryKnowledgeBase } from '../services/chromadb.service.js';
import { rerankDocuments } from '../services/reranker.service.js'; // CORREZIONE
import * as logger from '../utils/logger.js';

// Definizioni dei Tool (Function Declarations) per Gemini
const AVAILABLE_TOOLS = [
  {
    name: 'search_similar_episodes',
    description: 'Cerca nella memoria episodi di pesca passati con condizioni simili per trovare analogie e pattern.',
    parameters: {
      type: 'object',
      properties: {
        currentConditions: {
          type: 'object',
          description: 'Oggetto JSON con le condizioni meteo e di pesca attuali.'
        },
      },
      required: ['currentConditions']
    }
  },
  {
    name: 'search_knowledge_base',
    description: 'Cerca informazioni tecniche (es. tecniche di pesca, esche, comportamento specie) nella knowledge base generale.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'La domanda specifica da cercare nella knowledge base.'
        }
      },
      required: ['query']
    }
  }
];

/**
 * Esegue un tool specifico in base al nome e agli argomenti.
 */
async function executeToolCall(functionCall) {
    const { name, args } = functionCall;
    logger.log(`[Agent] -> Esecuzione Tool: ${name}`);
    
    try {
        let result;
        switch (name) {
            case 'search_similar_episodes':
                // Nota: findSimilarEpisodes si aspetta un oggetto specifico
                result = await findSimilarEpisodes(args.currentConditions, 5);
                break;
            case 'search_knowledge_base':
                const rawResults = await queryKnowledgeBase(args.query, 5);
                // Il re-ranking è opzionale ma migliora la qualità
                if (rerankDocuments) { // CORREZIONE
                    result = await rerankDocuments(args.query, rawResults); // CORREZIONE
                } else {
                    result = rawResults;
                }
                break;
            default:
                result = { error: `Tool sconosciuto: ${name}` };
        }
        return {
            functionResponse: {
                name: name,
                response: { result: result },
            },
        };
    } catch (error) {
        logger.error(`[Agent] ❌ Errore esecuzione tool ${name}:`, error);
        return {
            functionResponse: {
                name: name,
                response: { error: error.message },
            },
        };
    }
}

/**
 * Orchestratore principale dell'Agente (Pseudo-ReACT Loop).
 */
export async function executeFishingAgent(userQuery, context) {
    logger.log(`[Agent] 🎯 Avvio esecuzione per query: "${userQuery.substring(0, 50)}..."`);
    const MAX_ITERATIONS = 3;
    const conversationHistory = [];

    const systemPrompt = `Sei un assistente esperto di pesca. Il tuo compito è rispondere alla domanda dell'utente usando gli strumenti a tua disposizione. Analizza la domanda, usa gli strumenti per raccogliere dati, e poi formula una risposta completa.`;

    // Aggiungi il prompt di sistema e la query iniziale alla cronologia
    conversationHistory.push({ role: 'user', parts: [{ text: `Contesto: ${JSON.stringify(context)}\n\nDomanda: ${userQuery}` }] });

    for (let i = 0; i < MAX_ITERATIONS; i++) {
        logger.log(`[Agent] Iterazione ${i + 1}/${MAX_ITERATIONS}`);

        try {
            const candidate = await generateWithTools({
                contents: conversationHistory,
                systemInstruction: { parts: [{ text: systemPrompt }] },
                tools: [{ functionDeclarations: AVAILABLE_TOOLS }],
            });

            if (!candidate || !candidate.content) {
                logger.warn('[Agent] Risposta vuota da Gemini, termino il ciclo.');
                break;
            }

            const content = candidate.content;
            conversationHistory.push(content); // Aggiungi la risposta del modello alla cronologia

            const toolCalls = content.parts.filter(part => part.functionCall).map(part => part.functionCall);

            if (toolCalls.length === 0) {
                logger.log('[Agent] ✅ Nessun tool call, l\'agente ha finito.');
                break; // Esce dal loop per dare la risposta finale
            }

            // Esegui i tool richiesti
            const toolResults = await Promise.all(toolCalls.map(executeToolCall));

            // Aggiungi i risultati dei tool alla cronologia per l'iterazione successiva
            conversationHistory.push({
                role: 'tool',
                parts: toolResults,
            });

        } catch (error) {
            logger.error(`[Agent] ❌ Errore critico durante l'iterazione ${i + 1}:`, error);
            // In caso di errore, esce dal loop e tenta di dare una risposta con i dati che ha
            break;
        }
    }

    // --- Generazione della risposta finale ---
    // Prendi l'ultima risposta del modello nella cronologia.
    // Se l'ultimo messaggio era una chiamata a un tool, ne genera una nuova
    // forzando a non usare tool.
    const lastMessage = conversationHistory[conversationHistory.length - 1];
    if (lastMessage.role === 'tool' || (lastMessage.role === 'model' && lastMessage.parts.some(p => p.functionCall))) {
        logger.log('[Agent] Generazione della risposta finale...');
        const finalCandidate = await generateWithTools({
            contents: [...conversationHistory, {role: 'user', parts: [{text: "Basandoti sulla cronologia, formula la tua risposta finale."}]}],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [], // Forza a non usare tool
        });
        if (finalCandidate?.content?.parts) {
             return finalCandidate.content.parts.map(p => p.text).join('').trim();
        }
    }
    
    // Altrimenti, l'ultima risposta del modello è già la risposta finale
    const finalParts = lastMessage.parts.filter(p => p.text);
    if (finalParts.length > 0) {
        return finalParts.map(p => p.text).join('').trim();
    }
    
    logger.error("[Agent] ❌ Impossibile generare una risposta finale.");
    return "Non sono riuscito a elaborare una risposta. Riprova.";
}