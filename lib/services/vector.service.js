// lib/services/vector.service.js

import { queryKnowledgeBase as queryDB } from './chromadb.service.js';

export async function queryKnowledgeBase(query, topK = 5) {
  try {
    const results = await queryDB(query, topK);
    return results.map(r => r.text);
  } catch (error) {
    console.error('[VectorService] ❌ Errore:', error.message);
    return [];
  }
}

export function loadKnowledgeBase() {
  // Funzione deprecata
  return true;
}