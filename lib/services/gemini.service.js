// lib/services/gemini.service.js

const { GoogleGenerativeAI } = require("@google/generative-ai");
const { getKnowledgeFor } = require("../domain/knowledge_base"); 
// --- NUOVA IMPORTAZIONE ---
const { getSimulatedWeather } = require("../domain/weather.service");
// -------------------------

// Access your API key as an environment variable
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Model selection
const model = genAI.getGenerativeModel({ model: "models/gemini-2.5-flash"}); 

/**
 * Funzione principale per ottenere consigli di pesca tramite il flusso RAG.
 *
 * @param {string} userQuery - La query specifica dell'utente (es. "che esche uso?").
 * @param {string} location - Località per cui recuperare i dati meteo.
 * @param {string} date - Data dell'analisi.
 * @returns {Promise<string>} Il consiglio di pesca generato da Gemini.
 */
async function getFishingAdvice(userQuery, location, date) {
    try {
        // 1. RECUPERO DATI METEO (Simulazione)
        const weatherData = getSimulatedWeather(location, date);
        
        // 2. RECUPERO CONOSCENZA (RAG - Retrieval)
        // Usiamo le condizioni per interrogare la KB
        const knowledge = getKnowledgeFor(weatherData.kbQuery);

        // 3. COSTRUZIONE DEL MEGA-PROMPT (RAG - Prompt Engineering)
        const prompt = `
            Sei un esperto di pesca sportiva di nome 'Meteo Pesca AI'. Il tuo compito è fornire 
            un'analisi del giorno, suggerendo i pesci e le tecniche più adatte.

            Istruzioni per l'Analisi:
            1. Analizza i 'Dati Meteo Attuali' e le 'Regole Fondamentali' (la tua Knowledge Base).
            2. Fornisci un consiglio **strutturato** e professionale in formato Markdown.
            3. Inizia la risposta con un'Analisi Generale delle condizioni.
            4. DEDUCI i Pesci e le Tecniche più probabili basandoti sulle 'Regole Fondamentali' (es. mare in scaduta = Spigola).
            5. Rispondi alla specifica 'Richiesta Utente' utilizzando il contesto.

            Dati Meteo Attuali:
            ---
            ${weatherData.formattedString}
            ---
            
            Regole Fondamentali (KB):
            ---
            ${knowledge}
            ---

            Richiesta dell'utente: "${userQuery}"
        `;
        
        // 4. GENERAZIONE DELLA RISPOSTA (RAG - Generation)
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        
        return text;
    } catch (error) {
        console.error("[GeminiService] ERROR during advice generation:", error);
        // Utilizziamo un errore più specifico per l'API
        throw new Error("Errore durante la generazione del consiglio di pesca dall'AI.");
    }
}

// Esportiamo la nuova funzione con i parametri aggiornati
module.exports = { getFishingAdvice };