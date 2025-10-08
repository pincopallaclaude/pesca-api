// /tools/seed-vector.js
// Script autonomo per popolare la nostra base di conoscenza in-memory.

// Load environment variables for API keys
require('dotenv').config();

// Import il client vettoriale e i documenti
const { embeddingModel, populateIndex, queryKnowledgeBase } = require('../lib/services/vector.service');
const { KNOWLEDGE_DOCUMENTS } = require('../lib/domain/knowledge_base'); 

async function seedDatabase() {
    console.log("--- VectorDB Seeder (JS Array) ---");
    
    if (!process.env.GEMINI_API_KEY) {
        console.error("❌ ERRORE: GEMINI_API_KEY non è impostata nelle variabili d'ambiente. Impossibile generare gli embeddings.");
        return;
    }

    try {
        // 1. Prepara i contenuti testuali per l'embedding
        const documentsContent = KNOWLEDGE_DOCUMENTS.map(doc => doc.content);
        console.log(`- Preparazione per l'embedding di ${documentsContent.length} documenti...`);

        // 2. Genera embeddings usando il modello di Google in un batch
        // Questa sintassi è ottimizzata per l'embedding batch di Google AI.
        const result = await embeddingModel.batchEmbedContents({
            requests: documentsContent.map(content => ({
                content: { parts: [{ text: content }] }
            })),
        });
        
        // Estrae i valori vettoriali dal risultato
        const embeddings = result.embeddings.map(e => e.values);
        console.log(`- Generati con successo ${embeddings.length} embeddings.`);
        
        // 3. Popola l'indice vettoriale in-memory (JS Array)
        populateIndex(KNOWLEDGE_DOCUMENTS, embeddings);

        // 4. Test di verifica
        const testQuery = "Mare calmo con sole, cosa pesco?";
        const verificationResult = await queryKnowledgeBase(testQuery, 1); // Chiama il servizio corretto

        console.log(`\n✅ Successo! ${KNOWLEDGE_DOCUMENTS.length} documenti sono stati caricati nell'indice in-memory.`);
        console.log(`- Query di verifica: '${testQuery.substring(0, 30)}...'`);
        
        // CORREZIONE: Gestisce il caso in cui verificationResult sia vuoto per evitare il TypeError
        const snippet = verificationResult.length > 0 
            ? `"${verificationResult[0].substring(0, 50)}..."` 
            : "Nessun risultato rilevante trovato per la verifica.";
            
        console.log(`- Snippet di conoscenza pertinente: ${snippet}`);
        console.log("-----------------------");

    } catch (error) {
        console.error("\n❌ Si è verificato un errore critico durante il processo di seeding:");
        console.error(error);
    }
}

seedDatabase();