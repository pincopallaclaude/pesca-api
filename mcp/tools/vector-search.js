// // mcp/tools/vector-search.js

import { vectorService } from '../../lib/services/vector.service.js';

export async function vectorSearch({ query, topK = 5 }) {
  try {
    // Riusa la logica del servizio refattorizzato
    const results = await vectorService.searchSimilar(query, topK);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            query,
            resultsCount: results.length,
            documents: results.map(r => ({
              content: r.content,
              similarity: r.similarity,
              metadata: r.metadata,
            })),
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    throw new Error(`Vector search failed: ${error.message}`);
  }
}