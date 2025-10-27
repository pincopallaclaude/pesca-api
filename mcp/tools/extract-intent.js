// /mcp/tools/extract-intent.js

import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

export async function extractIntent({ query }) {
    const startTime = Date.now();
    try {
        // CORRETTO: Sostituito console.log con log
        log(`[MCP Intent] 🧠 Parsing query: "${query}"`);
        const prompt = `
Sei un parser di query di pesca. Analizza la domanda e estrai le info in formato JSON.
Query: "${query}"
Estrai:
- **type**: "forecast" | "species_recommendation" | "best_time" | "general_advice"
- **location**: località o null
- **species**: specie o null
- **timeframe**: "today" | "tomorrow" | "this_week" | "weekend" | null
- **technique**: tecnica o null
- **originalQuery**: query originale
Esempi:
Query: "Quando posso pescare spigole a Posillipo?" -> {"type":"best_time","location":"Posillipo","species":"spigola","timeframe":"today",...}
Query: "Previsioni per Napoli domani" -> {"type":"forecast","location":"Napoli","species":null,"timeframe":"tomorrow",...}
Query: "Come pescare orate?" -> {"type: "species_recommendation","location":null,"species":"orata",...}
Rispondi SOLO con il JSON.`;

        const response = await geminiGenerate(prompt);
        let intent;
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('Nessun JSON trovato');
            intent = JSON.parse(jsonMatch[0]);
        } catch (parseError) {

            log(`[MCP Intent] ⚠️ Errore parsing JSON: ${parseError.message}`);
            intent = { type: 'general_advice', originalQuery: query, parsingFailed: true };
        }
        
        const elapsed = Date.now() - startTime;
        log(`[MCP Intent] ✅ Intent estratto: ${intent.type} (${elapsed}ms)`);
        
        return {
            content: [{ type: 'text', text: JSON.stringify(intent, null, 2) }],
            metadata: { intentType: intent.type, timingMs: elapsed, parsingFailed: !!intent.parsingFailed }
        };
    } catch (error) {
        // CORRETTO: Sostituito console.error con log
        log(`[MCP Intent] ❌ Errore: Intent extraction failed: ${error.message}`);
        throw new Error(`Intent extraction failed: ${error.message}`);
    }
}
