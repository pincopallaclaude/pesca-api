// // mcp/tools/generate-analysis.js

import { geminiService } from '../../lib/services/gemini.service.js';
import { vectorService } from '../../lib/services/vector.service.js';

export async function generateAnalysis({ weatherData, location }) {
  try {
    const searchQuery = `Consigli di pesca per una giornata con queste condizioni a ${location}: vento ${weatherData.hourly.windspeed_10m[0]}km/h, stato del mare con onde alte ${weatherData.hourly.wave_height[0]}m, temperatura acqua ${weatherData.hourly.sea_surface_temperature[0]}°C.`;

    const relevantDocs = await vectorService.searchSimilar(searchQuery, 5);

    const enrichedPrompt = `Sei un esperto di pesca e assistente AI per l'app Meteo Pesca.
# Analisi di Pesca per ${location}

## Dati Meteo-Marini Rilevanti
- Vento: ${weatherData.hourly.windspeed_10m[0]} km/h
- Altezza Onde: ${weatherData.hourly.wave_height[0]} m
- Temperatura Acqua: ${weatherData.hourly.sea_surface_temperature[0]} °C
- Pressione: ${weatherData.hourly.pressure_msl[0]} hPa

## Conoscenza Rilevante dalla Knowledge Base
${relevantDocs.map((doc, i) => `---
### Documento #${i + 1} (Rilevanza: ${(doc.similarity * 100).toFixed(0)}%)
${doc.content}
`).join('\n')}
---

## Istruzioni
Basandoti **esclusivamente** sui dati meteo forniti e sulla conoscenza estratta, genera un'analisi di pesca dettagliata e pratica in formato Markdown. La tua analisi deve includere:
1.  **Valutazione Sintetica:** Un breve paragrafo che riassume le condizioni generali (es. "Condizioni ideali per...", "Giornata impegnativa a causa di...").
2.  **Specie Target Consigliate:** Una lista puntata delle specie più probabili da insidiare, motivando la scelta in base alle condizioni e alla knowledge base.
3.  **Tecniche e Strategie:** Consigli pratici su tecniche di pesca (es. spinning, bolentino), basandoti sui documenti trovati.
4.  **Consiglio sull'Attrezzatura:** Suggerimenti su esche, fili o montature menzionate nella knowledge base.

Sii conciso, pratico e usa un tono incoraggiante. Fai riferimento diretto ai documenti quando fornisci un consiglio specifico.`;

    const analysis = await geminiService.generateContent(enrichedPrompt);

    return {
      content: [{ type: 'text', text: analysis }],
      metadata: {
        documentsUsed: relevantDocs.length,
        generatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    throw new Error(`Analysis generation failed: ${error.message}`);
  }
}