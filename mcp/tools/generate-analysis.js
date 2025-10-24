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
# PERSONA
TU SEI un generatore di testo MARKDOWN. La tua unica funzione è convertire dati strutturati in una bella analisi testuale formattata in Markdown.

# CONTESTO
Un'applicazione di pesca ti sta fornendo dati grezzi e vuole indietro un'analisi ben scritta per un pescatore.

# DATI A TUA DISPOSIZIONE
## Dati Meteo-Marini per ${location}
${JSON.stringify(weatherData, null, 2)}

## Conoscenza Rilevante dalla Knowledge Base
${relevantDocs.length > 0 ? relevantDocs.map((doc, i) => `
### Fatto Rilevante ${i + 1}
${doc}
`).join('\n') : "Nessun fatto specifico trovato."}

# COMPITO E REGOLE DI OUTPUT FERREE
Il tuo UNICO output deve essere una stringa di testo in formato MARKDOWN.

**REGOLE ASSOLUTE:**
1. **NON USARE MAI, IN NESSUN CASO, BLOCCHI DI CODICE JSON.** La risposta non deve contenere \`\`\`json.
2. **NON USARE MAI CHIAVI O VALORI JSON.** La risposta non deve contenere parentesi graffe \`{}\` per definire oggetti.
3. L'output deve essere SOLO ed ESCLUSIVAMENTE la stringa Markdown, pronta per essere visualizzata.
4. Inizia sempre l'analisi con il titolo: \`### Analisi di Pesca per ${location}\`

Se non rispetti queste regole, l'applicazione che riceve la tua risposta andrà in crash. È fondamentale che tu produca solo Markdown.

Adesso, genera l'analisi in **SOLO MARKDOWN**.
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
