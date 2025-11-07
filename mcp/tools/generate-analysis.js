// /mcp/tools/generate-analysis.js

import { queryKnowledgeBase } from '../../lib/services/vector.service.js';
import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout (riservato al payload JSON)
const log = (msg) => process.stderr.write(`${msg}\n`);

export async function generateAnalysis({ weatherData, location }) {
    const startTime = Date.now();
    
    try {
        // Logging dell'avvio del tool
        log(`[MCP] 🎣 Analisi per ${location}`);
        
        // 1. RAG: Cerca documenti rilevanti nella knowledge base
        const searchQuery = `
            Condizioni: vento ${weatherData.wind?.speed || 'N/D'}km/h, 
            mare ${weatherData.sea?.state || 'N/D'}, 
            temp acqua ${weatherData.seaTemp || 'N/D'}°C, 
            località ${location}
        `;
        
        const relevantDocs = await queryKnowledgeBase(searchQuery, 5);
        // Logging dei risultati della ricerca
        log(`[MCP] ✅ Trovati ${relevantDocs.length} documenti rilevanti`);
        
        // 2. Costruisci prompt arricchito (Nuova logica e struttura restrittiva)
        const enrichedPrompt = `
# PERSONA
TU SEI un generatore di testo MARKDOWN. La tua UNICA funzione è scrivere testo formattato in Markdown.

# REGOLE DI OUTPUT FERREE E ASSOLUTE
1. **L'UNICO FORMATO DI OUTPUT PERMESSO È MARKDOWN.**
2. **È VIETATO PRODURRE QUALSIASI TIPO DI JSON.** Non usare \`\`\`json, non usare \`{\`, non usare chiavi come \`"analisiPesca"\`.
3. **L'output deve essere una SINGOLA stringa di testo Markdown.**
4. La violazione di queste regole causerà un errore critico. La tua aderenza è fondamentale.

# DATI A TUA DISPOSIZIONE
## Dati Meteo-Marini per ${location}
${JSON.stringify(weatherData, null, 2)}

## Conoscenza Rilevante dalla Knowledge Base
${relevantDocs.length > 0 ? relevantDocs.map((doc, i) => `
### Fatto Rilevante ${i + 1}
${doc}
`).join('\n') : "Nessun fatto specifico trovato."}

# COMPITO
Analizza i dati forniti e genera l'analisi di pesca richiesta, rispettando le regole di output. Inizia con \`### Analisi di Pesca per ${location}\`.

Adesso, genera l'analisi in **SOLO MARKDOWN**.
`;

        // 3. Genera con Gemini
        const analysis = await geminiGenerate(enrichedPrompt);
        
        const elapsed = Date.now() - startTime;
        // Logging del completamento
        log(`[MCP] 🏁 Completato in ${elapsed}ms`);
        
        return {
            content: [{ type: 'text', text: analysis }],
            metadata: {
                documentsUsed: relevantDocs.length,
                generatedAt: new Date().toISOString(),
                timingMs: elapsed
            }
        };
        
    } catch (error) {
        log(`[MCP] ❌ Errore: ${error.message}`);
        throw new Error(`Generazione fallita: ${error.message}`);
    }
}
  