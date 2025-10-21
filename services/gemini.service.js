// lib/services/gemini.service.js

import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const MODEL_NAME = "gemini-1.5-flash"; // Aggiornato a gemini-1.5-flash per coerenza

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const geminiService = {
    /**
     * Genera contenuto testuale utilizzando il modello Gemini con logica di retry.
     * @param {string} prompt - Il prompt completo da inviare al modello.
     * @returns {Promise<string>} La risposta testuale del modello.
     */
    async generateContent(prompt) {
        const MAX_RETRIES = 3;
        let lastError = null;

        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: MODEL_NAME });
                const result = await model.generateContent(prompt);
                const response = await result.response;
                return response.text();
            } catch (error) {
                lastError = error;
                if (error.status === 503 || error.message?.includes('503')) {
                    const waitTime = Math.pow(2, attempt) * 1000 + (Math.random() * 1000);
                    console.warn(`[GeminiService] Attempt ${attempt + 1}/${MAX_RETRIES} failed (503). Retrying in ${Math.round(waitTime / 1000)}s...`);
                    if (attempt < MAX_RETRIES - 1) {
                        await delay(waitTime);
                        continue;
                    }
                }
                console.error("[GeminiService] ERROR during generation:", error.message);
                throw new Error(`Failed to generate content: ${error.message}`);
            }
        }
        throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || 'Unknown'}`);
    }
};

export { geminiService };