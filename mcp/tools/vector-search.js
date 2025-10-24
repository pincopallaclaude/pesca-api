// /mcp/tools/vector-search.js

import { queryKnowledgeBase } from '../../lib/services/vector.service.js';

export async function vectorSearch({ query, topK = 5 }) {
  try {
    const results = await queryKnowledgeBase(query, topK);
    
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          query,
          resultsCount: results.length,
          documents: results
        }, null, 2)
      }]
    };
  } catch (error) {
    throw new Error(`Vector search fallito: ${error.message}`);
  }
}
