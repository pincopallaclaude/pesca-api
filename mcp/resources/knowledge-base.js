// /mcp/resources/knowledge-base.js

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Funzione di logging unificata che scrive su stderr per non contaminare stdout
const log = (msg) => process.stderr.write(`${msg}\n`);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function getKnowledgeBase() {
    try {
        // Path assoluto dalla root del progetto
        const kbPath = path.join(__dirname, '../../knowledge_base.json');
        // MODIFICA: Uso log()
        log(`[MCP] 📖 Caricamento KB da: ${kbPath}`);
        
        const data = await fs.readFile(kbPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        // MODIFICA: Uso log() con la sintassi richiesta
        log(`[MCP] ❌ Errore caricamento KB: ${error.message}`);
        throw new Error(`Impossibile leggere knowledge base: ${error.message}`);
    }
}
