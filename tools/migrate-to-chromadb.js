// tools/migrate-to-chromadb.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { addDocuments, initializeChromaDB } from '../lib/services/chromadb.service.js';
import * as logger from '../lib/utils/logger.js';
import crypto from 'crypto'; // Importiamo il modulo crypto per generare hash

export async function migrateKnowledgeBase() {
    try {
        logger.log('[Migrator] Avvio del processo di migrazione...');
        await initializeChromaDB();

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const kbPath = path.join(__dirname, '..', 'knowledge_base.json');

        logger.log(`[Migrator] Lettura di ${kbPath}`);
        const kbFile = await fs.readFile(kbPath, 'utf-8');
        const documentsToLoad = JSON.parse(kbFile);

        if (!documentsToLoad || documentsToLoad.length === 0) {
            logger.error('[Migrator] Errore: knowledge_base.json è vuoto.');
            return;
        }

        logger.log(`[Migrator] Trovati ${documentsToLoad.length} documenti da processare.`);

        // --- INIZIO MODIFICA CHIAVE: Assegnazione ID ---
        const documentsWithIds = documentsToLoad.map((doc, index) => {
            // Creiamo un ID stabile basato sul contenuto. Se il contenuto non cambia, l'ID rimane lo stesso.
            const contentHash = crypto.createHash('sha256').update(doc.content).digest('hex');
            return {
                ...doc,
                // Assicuriamoci che l'ID sia una stringa e univoco
                id: `doc_${index}_${contentHash.substring(0, 16)}` 
            };
        });
        // --- FINE MODIFICA CHIAVE ---

        const chunkSize = 100;
        for (let i = 0; i < documentsWithIds.length; i += chunkSize) {
            const chunk = documentsWithIds.slice(i, i + chunkSize);
            logger.log(`[Migrator] Caricamento del chunk ${Math.floor(i / chunkSize) + 1}...`);
            await addDocuments(chunk);
        }
        
        logger.log('[Migrator] ✅ Migrazione completata con successo!');
    } catch (error) {
        logger.error(`[Migrator] ❌ Fallimento del processo di migrazione: ${error.message}`);
        console.error(error.stack);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrateKnowledgeBase();
}