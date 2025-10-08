// lib/services/gemini.service.js

const { GoogleGenerativeAI } = require("@google/generative-ai");

// Inizializza il client AI con la chiave d'ambiente
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// CORREZIONE CRITICA: Usiamo il modello stabile e supportato 'gemini-2.5-flash'
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash"});


/**
 * Esegue un controllo di base per assicurarsi che il servizio Gemini sia raggiungibile.
 * @returns {Promise<string>} Messaggio di stato.
 */
async function runHealthCheck() {
  try {
    const result = await model.generateContent("Say 'AI Service Operational'.");
    const response = result.response;
    const text = response.text();
    return `Health Check OK: ${text}`;
  } catch (error) {
    console.error("[GeminiService] Health Check failed:", error);
    return "Health Check FAILED.";
  }
}


/**
 * Genera il contenuto (l'analisi di pesca) basato sul prompt complesso fornito,
 * che include i dati meteo-marini e la knowledge base.
 * * @param {string} prompt Il prompt completo da inviare all'AI.
 * @returns {Promise<string>} Il contenuto testuale generato dall'AI.
 */
async function generateAnalysis(prompt) {
  try {
    // Chiamata all'API per generare l'analisi
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    
    console.log('[GeminiService] Analysis generated successfully.');
    return text;
    
  } catch (error) {
    console.error("[GeminiService] ERROR during analysis generation:", error);
    // Rilancia l'errore per essere gestito dal try/catch nel server.js
    throw new Error("Failed to generate content from AI service: " + error.message);
  }
}


module.exports = { 
  runHealthCheck,
  generateAnalysis, // Esportiamo la nuova funzione necessaria per l'endpoint /api/analyze-day
};
