// tools/migrate-to-chromadb.js
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
// --- CORREZIONE: Punta al file corretto 'chromadb.service.js' ---
import { addDocuments, initializeChromaDB } from '../lib/services/chromadb.service.js'; 
import * as logger from '../utils/logger.js';
import crypto from 'crypto';

export async function migrateKnowledgeBase() {
    try {
        logger.log('[Migrator] Avvio del processo di migrazione...');
        await initializeChromaDB();

        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const kbPath = path.join(__dirname, '..', 'knowledge_base.json');
        const kbFile = await fs.readFile(kbPath, 'utf-8');
        const documentsToLoad = JSON.parse(kbFile);

        if (!documentsToLoad || documentsToLoad.length === 0) {
            logger.error('[Migrator] Errore: knowledge_base.json è vuoto.');
            return;
        }

        const documentsWithIds = documentsToLoad.map((doc, index) => {
            const contentHash = crypto.createHash('sha256').update(doc.content).digest('hex');
            return {
                ...doc,
                id: `doc_${index}_${contentHash.substring(0, 16)}` 
            };
        });

        const chunkSize = 100;
        for (let i = 0; i < documentsWithIds.length; i += chunkSize) {
            const chunk = documentsWithIds.slice(i, i + chunkSize);
            await addDocuments(chunk);
        }
        
    } catch (error) {
        logger.error(`[Migrator] ❌ Fallimento del processo di migrazione: ${error.message}`);
        console.error(error.stack);
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    migrateKnowledgeBase();
}