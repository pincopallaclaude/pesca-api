// tools/migrate-to-chromadb.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { addDocuments, initializeChromaDB } from '../lib/services/chromadb.service.js';
import * as logger from '../lib/utils/logger.js';

// Funzione principale esportabile
export async function migrateKnowledgeBase() {
    try {
        logger.log('[Migrator] Avvio del processo di migrazione...');
        await initializeChromaDB(); // Assicura che il client sia pronto

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const kbPath = path.join(__dirname, '..', 'knowledge_base.json');

        logger.log(`[Migrator] Lettura di ${kbPath}`);
        const kbFile = await fs.readFile(kbPath, 'utf-8');
        const documentsToLoad = JSON.parse(kbFile);

        if (!documentsToLoad || documentsToLoad.length === 0) {
            logger.error('[Migrator] Errore: knowledge_base.json è vuoto o non valido.');
            return;
        }

        logger.log(`[Migrator] Trovati ${documentsToLoad.length} documenti da caricare.`);
        
        const chunkSize = 100;
        for (let i = 0; i < documentsToLoad.length; i += chunkSize) {
            const chunk = documentsToLoad.slice(i, i + chunkSize);
            logger.log(`[Migrator] Caricamento del chunk ${Math.floor(i / chunkSize) + 1}...`);
            await addDocuments(chunk);
        }
        
        logger.log('[Migrator] ✅ Migrazione completata con successo!');
    } catch (error) {
        logger.error(`[Migrator] ❌ Fallimento del processo di migrazione: ${error.message}`);
        console.error(error.stack);
    }
}

// Logica per consentire l'esecuzione anche da riga di comando
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrateKnowledgeBase();
}