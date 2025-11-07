// test-gemini.js

// Load environment variables
require('dotenv').config();

// Importa la nuova funzione
const { getFishingAdvice } = require("./lib/services/gemini.service");

async function test() {
    console.log("Running Gemini KB integration test...");

    // Simuliamo una richiesta dell'utente con condizioni specifiche:
    const userQuestion = "Vorrei andare a traina costiera. Quali esche sono consigliate?";
    const currentConditions = "mare calmo e vento debole"; // Queste parole chiave attiveranno la KB

    try {
        const advice = await getFishingAdvice(userQuestion, currentConditions);
        
        console.log("\n--- TEST SUCCESS ---");
        console.log(`Query Utente: ${userQuestion}`);
        console.log(`Condizioni: ${currentConditions}`);
        console.log("\nConsiglio di Meteo Pesca AI:\n", advice);
        
    } catch (error) {
        console.error("\n--- TEST FAILED ---");
        console.error(error.message);
    }
}

test();