// /lib/services/mistral.service.js

/**
 * Mistral AI API Service
 * Wrapper per i modelli Mistral (es. open-mistral-7b per il free tier)
 */
import MistralClient from '@mistralai/mistralai';

let client;
const apiKey = process.env.MISTRAL_API_KEY;

if (apiKey && apiKey !== 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') {
    client = new MistralClient(apiKey);
} else {
    console.warn('[Mistral Service] ⚠️ MISTRAL_API_KEY non impostata. Il servizio Mistral non sarà disponibile.');
}

/**
 * Genera analisi con un modello Mistral
 * @param {string} prompt - Prompt completo
 * @param {Object} options - Opzioni generazione
 * @returns {Promise<string>} Testo generato
 */
export async function generateWithMistral(prompt, options = {}) {
    if (!client) {
        throw new Error('Mistral client non inizializzato. Controllare MISTRAL_API_KEY.');
    }

    const {
        model = 'open-mistral-7b', // Modello performante e spesso disponibile nel free tier
        temperature = 0.7,
    } = options;

    try {
        console.log('[Mistral Service] 🧠 Generazione analisi con Mistral...');
        const startTime = Date.now();

        const chatResponse = await client.chat({
            model: model,
            messages: [{ role: 'user', content: prompt }],
            temperature: temperature,
        });

        const elapsed = Date.now() - startTime;
        console.log(`[Mistral Service] ✅ Completato in ${elapsed}ms`);
        
        const text = chatResponse.choices[0].message.content;
        return text;
    } catch (error) {
        console.error('[Mistral Service] ❌ Errore:', error.message);
        throw new Error(`Mistral API fallita: ${error.message}`);
    }
}

/**
 * Verifica disponibilità Mistral API
 * @returns {Promise<boolean>}
 */
export async function isMistralAvailable() {
    return !!client;
}