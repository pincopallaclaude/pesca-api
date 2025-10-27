// /lib/services/claude.service.js

/**
 * Claude API Service (Anthropic)
 * Wrapper per Claude Sonnet (analisi profonde/complesse)
 */
import Anthropic from '@anthropic-ai/sdk';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

let client;
const apiKey = process.env.ANTHROPIC_API_KEY;

if (apiKey) {
    client = new Anthropic({ apiKey });
} else {
    // Sostituito console.warn con la funzione log
    log('[Claude Service] ⚠️ ANTHROPIC_API_KEY non impostata. Il servizio Claude non sarà disponibile.');
}

/**
 * Genera analisi complessa con Claude Sonnet
 * @param {string} prompt - Prompt completo
 * @param {Object} options - Opzioni generazione
 * @returns {Promise<string>} Testo generato
 */
export async function generateWithClaude(prompt, options = {}) {
    if (!client) {
        throw new Error('Claude client non inizializzato. Controllare ANTHROPIC_API_KEY.');
    }

    const {
        model = 'claude-3-sonnet-20240229', // Modello aggiornato e stabile
        max_tokens = 2000,
        temperature = 0.7,
    } = options;

    try {
        // Sostituito console.log con la funzione log
        log('[Claude Service] 🧠 Generazione analisi complessa...');
        const startTime = Date.now();

        const message = await client.messages.create({
            model: model,
            max_tokens: max_tokens,
            temperature: temperature,
            messages: [{ role: 'user', content: prompt }],
        });

        const elapsed = Date.now() - startTime;
        // Sostituito console.log con la funzione log
        log(`[Claude Service] ✅ Completato in ${elapsed}ms`);
        
        const text = message.content[0].text;
        return text;
    } catch (error) {
        // Sostituito console.error con la funzione log e il formato richiesto
        log(`[Claude Service] ❌ Errore: ${error.message}`);
        throw new Error(`Claude API fallita: ${error.message}`);
    }
}

/**
 * Verifica disponibilità Claude API
 * @returns {Promise<boolean>}
 */
export function isClaudeAvailable() {
    return !!client;
}
