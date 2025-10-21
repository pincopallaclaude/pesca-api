// /mcp/resources/knowledge-base.js

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function getKnowledgeBase() {
  try {
    const kbPath = path.join(__dirname, '../../../knowledge_base.json');
    const data = await fs.readFile(kbPath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`Could not read knowledge base: ${error.message}`);
  }
}