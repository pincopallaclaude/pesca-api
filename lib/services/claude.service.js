// /lib/services/claude.service.js

import Anthropic from '@anthropic-ai/sdk';
import * as logger from '../utils/logger.js';

let client;
const apiKey = process.env.ANTHROPIC_API_KEY;

if (apiKey) {
    client = new Anthropic({ apiKey });
} else {
    logger.warn('[Claude Service] ⚠️ ANTHROPIC_API_KEY non impostata. Il servizio non sarà disponibile.');
}

/**
 * [MODIFICATO] Accetta un oggetto richiesta in formato Gemini e lo adatta per Claude.
 * @param {object} geminiRequest - Oggetto richiesta (es. { contents: [...] })
 * @returns {Promise<object>} Una risposta che SIMULA la struttura della risposta di Gemini.
 */
export async function generateWithClaude(geminiRequest) {
    if (!client) {
        throw new Error('Claude client non inizializzato.');
    }

    try {
        // --- INIZIO BLOCCO DI TRADUZIONE ---
        // Claude, come Mistral, accetta un semplice array di messaggi.
        // Dobbiamo estrarre e appiattire la cronologia.
        const messages = geminiRequest.contents
            .filter(c => c.role === 'user' || c.role === 'model')
            .map(c => ({
                role: c.role,
                content: c.parts.map(p => p.text || '').join(' ')
            }));
        
        if (messages.length === 0) {
            throw new Error('Nessun messaggio valido da inviare a Claude.');
        }
        // --- FINE BLOCCO DI TRADUZIONE ---

        logger.log('[Claude Service] 🧠 Generazione analisi con Claude...');
        const startTime = Date.now();

        const message = await client.messages.create({
            model: 'claude-3-sonnet-20240229',
            max_tokens: 2000,
            temperature: 0.7,
            messages: messages, // Usa i messaggi tradotti
        });

        const elapsed = Date.now() - startTime;
        logger.log(`[Claude Service] ✅ Completato in ${elapsed}ms`);
        
        const text = message.content[0].text;

        // --- SIMULA RISPOSTA DI GEMINI ---
        return {
            candidates: [{
                content: {
                    parts: [{ text: text }],
                    role: 'model'
                }
            }]
        };
        // --- FINE SIMULAZIONE ---

    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`[Claude Service] ❌ Errore: ${errorMessage}`);
        throw new Error(`Claude API fallita: ${errorMessage}`);
    }
}