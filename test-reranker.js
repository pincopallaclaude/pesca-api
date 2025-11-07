// test-reranker.js

import 'dotenv/config';
import { initializeChromaDB, queryKnowledgeBase } from './lib/services/chromadb.service.js';
import * as logger from './lib/utils/logger.js'; // Usa l'import nominativo/namespace

/**
 * Esegue un test comparativo per validare l'efficacia del re-ranking.
 */
async function testReranking() {
  logger.log('--- Inizializzazione del Test di Re-ranking ---');
  
  try {
    // Inizializza la connessione con ChromaDB
    await initializeChromaDB();
    logger.log('✅ Connessione a ChromaDB stabilita.');

    // Definisci una query di test significativa
    const query = 'artificiali migliori per la pesca a spinning alla spigola in foce con mare mosso';
    const topK = 4;
    const rerankCandidates = 10;

    logger.log(`\nQUERY DI TEST: "${query}"`);
    logger.log('----------------------------------------------------');

    // --- TEST 1: Senza Re-ranking (Ordine standard di ChromaDB) ---
    logger.log('\n▶️ ESEGUO TEST SENZA RE-RANKING...');
    const resultsWithoutReranking = await queryKnowledgeBase(query, { 
      topK: topK 
    });
    
    logger.log('\n--- RISULTATI SENZA RE-RANKING (Ordine ChromaDB) ---');
    if (resultsWithoutReranking.length > 0) {
      resultsWithoutReranking.forEach((doc, i) => {
        logger.log(`${i + 1}. [Sim: ${doc.similarity.toFixed(4)}] ${doc.metadata?.title || 'No Title'}`);
        logger.log(`   "${doc.content.substring(0, 100).replace(/\n/g, ' ')}..."`);
      });
    } else {
      logger.warn('Nessun risultato trovato.');
    }
    logger.log('----------------------------------------------------');

    // --- TEST 2: Con Re-ranking Attivo ---
    logger.log('\n▶️ ESEGUO TEST CON RE-RANKING ATTIVO...');
    const resultsWithReranking = await queryKnowledgeBase(query, {
      topK: topK,
      useReranking: true,
      rerankTopK: rerankCandidates,
    });
    
    logger.log('\n--- RISULTATI CON RE-RANKING (Ordine Cross-Encoder) ---');
    if (resultsWithReranking.length > 0) {
      resultsWithReranking.forEach((doc, i) => {
        // Il rerankScore viene aggiunto dal nostro servizio
        logger.log(`${i + 1}. [Re-Rank Score: ${doc.rerankScore ? doc.rerankScore.toFixed(4) : 'N/A'}] ${doc.metadata?.title || 'No Title'}`);
        logger.log(`   "${doc.content.substring(0, 100).replace(/\n/g, ' ')}..."`);
      });
    } else {
      logger.warn('Nessun risultato trovato.');
    }
    logger.log('----------------------------------------------------');

    logger.log('\n✅ Test completato. Confronta i due set di risultati per validare il miglioramento dell\'ordine.');

  } catch (error) {
    logger.error(`❌ ERRORE CRITICO DURANTE IL TEST: ${error.message}`);
    console.error(error); // Logga lo stack trace completo
  }
}

// Esegui la funzione di test
testReranking();