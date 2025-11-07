// tools/migrate-to-chromadb.js

import fs from 'fs';
import { ChromaClient } from 'chromadb';
import dotenv from 'dotenv';
// 🔥 IMPORTA CORRETTAMENTE GEMINI
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const KB_FILE = './knowledge_base.json';
const COLLECTION_NAME = 'fishing_knowledge';
const CHROMA_URL = 'http://localhost:8001';

// 🔥 INIZIALIZZA GEMINI CORRETTAMENTE
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

async function generateEmbedding(text) {
    const result = await embeddingModel.embedContent({ content: { parts: [{ text }] } });
    return result.embedding.values;
}

async function migrate() {
    console.log('🔄 Migrazione knowledge_base.json → ChromaDB...\n');
    
    // Per un'esecuzione su Fly.io, si usa l'URL interno del container ChromaDB
    const chromaHost = process.env.CHROMA_HOST || CHROMA_URL;
    console.log(`📡 Connessione a ChromaDB su: ${chromaHost}`);
    
    const kbData = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
    console.log(`📖 Letti ${kbData.length || 0} documenti da JSON`);

    const client = new ChromaClient({ path: chromaHost });

    try {
        await client.deleteCollection({ name: COLLECTION_NAME });
        console.log('🗑️ Collection esistente eliminata');
    } catch (e) { 
        // L'errore è atteso se la collection non esiste
        if (!e.message.includes('not found')) {
             console.error('❌ Errore durante l\'eliminazione della collection:', e.message);
        }
        console.log('ℹ️ Nessuna collection da eliminare o errore gestito.'); 
    }
    
    // ChromaDB JS accetta solo oggetti con una proprietà 'generate' che prende [string] e restituisce Promise<number[][]>
    const geminiEmbedder = {
        generate: async function(texts) {
            console.log(`[Embedder] Genero ${texts.length} embeddings...`);
            // Nota: batchEmbedContents ha un limite di 100 per richiesta
            const result = await embeddingModel.batchEmbedContents({
                requests: texts.map(text => ({ content: { parts: [{ text }] } }))
            });
            return result.embeddings.map(e => e.values);
        }
    };

    const collection = await client.createCollection({
        name: COLLECTION_NAME,
        embeddingFunction: geminiEmbedder,
    });
    console.log(`✅ Collection "${COLLECTION_NAME}" creata\n`);

    if (!kbData || kbData.length === 0) {
        console.log('✅ File JSON vuoto.');
        return;
    }
    
    const BATCH_SIZE = 50;
    for (let i = 0; i < kbData.length; i += BATCH_SIZE) {
        const batch = kbData.slice(i, i + BATCH_SIZE);
        
        // CORREZIONE METADATA
        const metadatas = batch.map(d => {
            // Uniamo tutti i dati che vogliamo conservare in un unico oggetto
            const dataToStore = {
                // Copia i metadati esistenti (se esistono)
                ...(d.metadata || {}), 
                // Aggiungi il contenuto del chunk
                content: d.content,
                // Aggiungi il contenuto originale del documento (per la RAG)
                parent_content: d.parent_content || d.content 
            };
            
            // 🔥 SERIALIZZA l'intero oggetto in una STRINGA per conformità con ChromaDB JS
            // La chiave `source_data` sarà recuperata come stringa.
            return {
                source_data: JSON.stringify(dataToStore),
            };
        });

        await collection.add({
            ids: batch.map((_, idx) => `doc_${i + idx}`),
            documents: batch.map(d => d.content), // Usa 'content' per l'embedding
            metadatas: metadatas,
        });

        console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} documenti aggiunti`);
    }

    const count = await collection.count();
    console.log(`\n✅ Migrazione completata: ${count} documenti in ChromaDB`);
}

migrate().catch(err => {
    console.error("ERRORE DURANTE LA MIGRAZIONE:", err);
    process.exit(1);
});
