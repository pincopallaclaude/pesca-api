// /mcp/tools/generate-analysis.js

import { queryKnowledgeBase } from '../../lib/services/vector.service.js';
import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';

export async function generateAnalysis({ weatherData, location }) {
  const startTime = Date.now();
  
  try {
    // MODIFICA: Uso console.error per il logging dei tool
    console.error(`[MCP] 🎣 Analisi per ${location}`);
    
    // 1. RAG: Cerca documenti rilevanti
    const searchQuery = `
      Condizioni: vento ${weatherData.wind?.speed || 'N/D'}km/h, 
      mare ${weatherData.sea?.state || 'N/D'}, 
      temp acqua ${weatherData.seaTemp || 'N/D'}°C, 
      località ${location}
    `;
    
    const relevantDocs = await queryKnowledgeBase(searchQuery, 5);
    // MODIFICA: Uso console.error
    console.error(`[MCP] ✅ Trovati ${relevantDocs.length} documenti rilevanti`);
    
    // 2. Costruisci prompt arricchito
    const enrichedPrompt = `
# Analisi Pesca per ${location}

## Dati Meteo-Marini
${JSON.stringify(weatherData, null, 2)}

## Conoscenza dalla Knowledge Base
${relevantDocs.map((doc, i) => `
### Documento ${i + 1}
${doc}
`).join('\n')}

## Istruzioni
Genera analisi dettagliata in Markdown con:
1. Valutazione condizioni generali
2. Specie target consigliate
3. Tecniche specifiche (cita KB quando pertinente)
4. Esche/attrezzatura
5. Orari ottimali

Stile professionale ma accessibile.
`;

    // 3. Genera con Gemini
    const analysis = await geminiGenerate(enrichedPrompt);
    
    const elapsed = Date.now() - startTime;
    // MODIFICA: Uso console.error
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
