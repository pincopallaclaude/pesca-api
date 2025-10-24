// /mcp/resources/knowledge-base.js

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function getKnowledgeBase() {
  try {
    // Path assoluto dalla root del progetto
    const kbPath = path.join(__dirname, '../../knowledge_base.json');
    // MODIFICA: Uso console.error per il logging dei tool
    console.error(`[MCP] 📖 Caricamento KB da: ${kbPath}`);
    
    const data = await fs.readFile(kbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[MCP] ❌ Errore caricamento KB:', error);
    throw new Error(`Impossibile leggere knowledge base: ${error.message}`);
  }
}
