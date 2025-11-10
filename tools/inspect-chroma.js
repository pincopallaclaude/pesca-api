// tools/inspect-chroma.js
import axios from 'axios';

const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';
const COLLECTION_NAME = process.env.CHROMA_COLLECTION || 'fishing_knowledge';

async function inspect() {
    console.log(`--- Ispezione di ChromaDB (${CHROMA_API_URL}) ---`);
    try {
        // 1. Ottieni la collection per avere l'ID
        const collections = await axios.get(`${CHROMA_API_URL}/collections`);
        const collection = collections.data.find(c => c.name === COLLECTION_NAME);
        
        if (!collection) {
            console.error(`ERRORE: Collection "${COLLECTION_NAME}" non trovata.`);
            return;
        }
        console.log(`Trovata collection: ${collection.name} (ID: ${collection.id})`);

        // 2. Conta i documenti
        const countResponse = await axios.get(`${CHROMA_API_URL}/collections/${collection.id}/count`);
        console.log(`Numero totale di documenti: ${countResponse.data}`);

        // 3. Recupera i primi 5 documenti per vedere i metadati
        if (countResponse.data > 0) {
            const getResponse = await axios.post(`${CHROMA_API_URL}/collections/${collection.id}/get`, { limit: 5, include: ["metadatas"] });
            console.log("Esempio di metadati dei primi 5 documenti:");
            console.log(JSON.stringify(getResponse.data.metadatas, null, 2));
        }

    } catch (error) {
        console.error('Errore durante l\'ispezione:', error.response ? error.response.data : error.message);
    }
}

inspect();