// /mcp/tools/get-insight.js

import { vectorService } from '../../lib/services/vector.service.js';
import { geminiService } from '../../lib/services/gemini.service.js';

export async function getFishingInsight({ topic, context = {} }) {
  try {
    const docs = await vectorService.searchSimilar(topic, 3);

    if (docs.length === 0) {
      return {
        content: [{ type: 'text', text: `Nessuna informazione trovata per: "${topic}"` }],
      };
    }

    if (Object.keys(context).length > 0) {
      const prompt = `Basandoti su questa conoscenza:\n${docs.map(d => d.content).join('\n---\n')}\n\nE considerando il contesto meteo:\n${JSON.stringify(context, null, 2)}\n\nFornisci un consiglio pratico e specifico riguardo: ${topic}`;
      const insight = await geminiService.generateContent(prompt);
      return { content: [{ type: 'text', text: insight }] };
    }

    return {
      content: [{
          type: 'text',
          text: docs.map(d => `### Info su ${topic}\n${d.content}`).join('\n\n'),
      }],
    };
  } catch (error) {
    throw new Error(`Get insight failed: ${error.message}`);
  }
}