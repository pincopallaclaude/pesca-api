// /mcp/tools/generate-analysis.js

import { queryKnowledgeBase } from '../../lib/services/vector.service.js';
import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';

export async function generateAnalysis({ weatherData, location }) {
  const startTime = Date.now();
  
  try {
    // Logging dell'avvio del tool
    console.error(`[MCP] 🎣 Analisi per ${location}`);
    
    // 1. RAG: Cerca documenti rilevanti nella knowledge base
    const searchQuery = `
      Condizioni: vento ${weatherData.wind?.speed || 'N/D'}km/h, 
      mare ${weatherData.sea?.state || 'N/D'}, 
      temp acqua ${weatherData.seaTemp || 'N/D'}°C, 
      località ${location}
    `;
    
    const relevantDocs = await queryKnowledgeBase(searchQuery, 5);
    // Logging dei risultati della ricerca
    console.error(`[MCP] ✅ Trovati ${relevantDocs.length} documenti rilevanti`);
    
    // 2. Costruisci prompt arricchito (Nuova logica e struttura restrittiva)
        const enrichedPrompt = `
# CONTESTO E OBIETTIVO
Sei "Meteo Pesca AI", un assistente di pesca virtuale esperto e professionale. Il tuo obiettivo è fornire a un pescatore un'analisi strategica, dettagliata e di facile lettura, combinando i dati meteo-marini con la conoscenza specifica sulla pesca.

# DATI A TUA DISPOSIZIONE
## Dati Meteo-Marini per ${location}
${JSON.stringify(weatherData, null, 2)}

## Conoscenza Rilevante dalla Knowledge Base
${relevantDocs.length > 0 ? relevantDocs.map((doc, i) => `
### Fatto Rilevante ${i + 1}
${doc}
`).join('\n') : "Nessuna conoscenza specifica trovata per queste condizioni."}

# COMPITO: GENERA L'ANALISI DI PESCA
Analizza tutti i dati forniti e genera un report completo in formato Markdown. Sii discorsivo, spiega il *perché* delle tue raccomandazioni e, se possibile, cita i "Fatti Rilevanti" per supportare le tue conclusioni.

L'analisi deve includere:
*   **Panoramica Generale:** Un riassunto delle condizioni (meteo, mare, vento, pressione).
*   **Finestre di Pesca Consigliate:** I migliori orari per pescare, spiegando perché.
*   **Analisi Oraria e Fattori Chiave:** Descrivi come le condizioni evolvono durante il giorno.
*   **Punti di Forza e Debolezza:** Riassumi i pro e i contro della giornata.
*   **Specie, Tecniche e Consigli:** Sulla base dei dati e della knowledge base, suggerisci cosa pescare e come.

## REGOLE DI FORMATTAZIONE FINALE
*   **FORMATO:** La tua risposta deve essere esclusivamente in **Markdown**.
*   **STRUTTURA:** Usa titoli (\`###\`), grassetto (\`**\`) e liste puntate (\`*\`) per rendere il testo leggibile.
*   **NO JSON:** Non includere blocchi di codice JSON o parentesi graffe \`{\}\`.

Ora, scrivi l'analisi.
`;

    // 3. Genera con Gemini
    const analysis = await geminiGenerate(enrichedPrompt);
    
    const elapsed = Date.now() - startTime;
    // Logging del completamento
    console.error(`[MCP] 🏁 Completato in ${elapsed}ms`);
    
    return {
      content: [{ type: 'text', text: analysis }],
      metadata: {
        documentsUsed: relevantDocs.length,
        generatedAt: new Date().toISOString(),
        timingMs: elapsed
      }
    };
    
  } catch (error) {
    console.error(`[MCP] ❌ Errore:`, error);
    throw new Error(`Generazione fallita: ${error.message}`);
  }
}
