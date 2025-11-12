// /lib/services/mistral.service.js

import MistralClient from '@mistralai/mistralai';
import * as logger from '../utils/logger.js';

let client;
const apiKey = process.env.MISTRAL_API_KEY;

if (apiKey) {
    client = new MistralClient(apiKey);
} else {
    logger.warn('[Mistral Service] ⚠️ MISTRAL_API_KEY non impostata. Il servizio non sarà disponibile.');
}

/**
 * [MODIFICATO] Accetta un oggetto richiesta in formato Gemini e lo adatta per Mistral.
 * @param {object} geminiRequest - Oggetto richiesta (es. { contents: [...] })
 * @returns {Promise<object>} Una risposta che SIMULA la struttura della risposta di Gemini.
 */
export async function generateWithMistral(geminiRequest) {
    if (!client) {
        throw new Error('Mistral client non inizializzato.');
    }

    try {
        // --- INIZIO BLOCCO DI TRADUZIONE ---
        // Estrai l'ultimo messaggio 'user' come prompt principale.
        // Questo è un adattamento: Mistral non gestisce il tool calling come Gemini.
        const userMessages = geminiRequest.contents
            .filter(c => c.role === 'user')
            .flatMap(c => c.parts.map(p => p.text || ''))
            .join('\n');
        
        if (!userMessages) {
            throw new Error('Nessun contenuto "user" valido trovato nella richiesta per Mistral.');
        }
        // --- FINE BLOCCO DI TRADUZIONE ---

        logger.log('[Mistral Service] 🧠 Generazione analisi con Mistral...');
        const startTime = Date.now();

        const chatResponse = await client.chat({
            model: 'open-mistral-7b',
            messages: [{ role: 'user', content: userMessages }], // Usa il prompt tradotto
            temperature: 0.7,
        });

        const elapsed = Date.now() - startTime;
        logger.log(`[Mistral Service] ✅ Completato in ${elapsed}ms`);
        
        const text = chatResponse.choices[0].message.content;

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
        logger.error(`[Mistral Service] ❌ Errore: ${errorMessage}`);
        throw new Error(`Mistral API fallita: ${errorMessage}`);
    }
}