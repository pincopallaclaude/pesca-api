// /lib/db/memory.engine.js

/**
 * Hybrid Memory System (Zero-Cost)
 * - ChromaDB (Server via Axios): Semantic memory
 * - BetterSQLite3: Episodic memory (strutturata)
 * - node-cache: Hot cache (in-memory)
 */

import Database from 'better-sqlite3';
import NodeCache from 'node-cache';
import * as logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { getGeminiEmbeddings } from '../services/gemini.service.js'; // Import diretto
import axios from 'axios';

// --- Percorsi e Setup ---

// Determina la root dei dati e i percorsi del DB
const DATA_ROOT = process.env.NODE_ENV === 'production' 
    ? '/data' 
    : path.resolve('./data');
const DB_DIR = path.join(DATA_ROOT, 'memory');
const DB_PATH = path.join(DB_DIR, 'episodes.db');

// URL dell'API di ChromaDB in esecuzione su un server separato
const CHROMA_API_URL = process.env.CHROMA_URL || 'http://127.0.0.1:8001/api/v1';
const COLLECTION_NAME = 'fishing_episodes';

/** Assicura che la directory del database esista. */
function ensureDirectoryExists(dirPath) { 
    if (!fs.existsSync(dirPath)) { 
        fs.mkdirSync(dirPath, { recursive: true }); 
    } 
}
ensureDirectoryExists(DB_DIR);

// --- 1. EPISODIC MEMORY (SQLite) ---

const db = new Database(DB_PATH);

// Schema ottimizzato con indici (invariato)
db.exec(`
    CREATE TABLE IF NOT EXISTS fishing_episodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        location_lat REAL NOT NULL,
        location_lon REAL NOT NULL,
        location_name TEXT,
        weather_json TEXT NOT NULL,
        pesca_score_final REAL,
        pesca_score_predicted REAL,
        user_action TEXT,
        user_feedback INTEGER,
        outcome TEXT,
        embedding_id TEXT,
        model_version TEXT DEFAULT '1.0'
    );

    CREATE INDEX IF NOT EXISTS idx_created_at ON fishing_episodes(created_at);
    CREATE INDEX IF NOT EXISTS idx_location ON fishing_episodes(location_lat, location_lon);
    CREATE INDEX IF NOT EXISTS idx_session ON fishing_episodes(session_id);
    CREATE INDEX IF NOT EXISTS idx_feedback ON fishing_episodes(user_feedback);

    CREATE TABLE IF NOT EXISTS aggregated_stats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_zone TEXT NOT NULL,
        weather_pattern TEXT NOT NULL,
        avg_pesca_score REAL,
        avg_user_feedback REAL,
        sample_count INTEGER,
        last_updated INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_zone ON aggregated_stats(location_zone);
`);

// --- 2. SEMANTIC MEMORY (ChromaDB Server via Axios) ---

let isChromaReady = false;

/** Inizializza la connessione e verifica/crea la collezione ChromaDB. */
async function initChroma() {
    try {
        logger.info(`[Memory] Verifico connessione con ChromaDB a ${CHROMA_API_URL}...`);
        
        // Health Check e Versione
        const response = await axios.get(`${CHROMA_API_URL}/version`);
        logger.info(`[Memory] Connessione a ChromaDB v${response.data} riuscita.`);

        // Creazione della Collection (ignora 409 Conflict se già esistente)
        await axios.post(`${CHROMA_API_URL}/collections`, { 
            name: COLLECTION_NAME,
            metadata: { description: 'Episodic memory for fishing sessions' }
        }).catch(error => {
            if (error.response && error.response.status === 409) {
                logger.debug(`[Memory] Collection "${COLLECTION_NAME}" già esistente.`);
            } else { 
                throw error; 
            }
        });

        isChromaReady = true;
        logger.info('[Memory] ChromaDB pronto via API.');

    } catch (error) {
        const message = error.response ? `Status ${error.response.status}: ${JSON.stringify(error.response.data)}` : error.message;
        logger.error(`[Memory] Init ChromaDB via Axios fallito: ${message}`);
        // Non rilanciare l'errore se il servizio di memoria non è critico all'avvio
        // Però, per coerenza con il codice originale, lo rilancio
        throw error; 
    }
}

// --- 3. HOT CACHE (node-cache) ---
const hotCache = new NodeCache({ 
    stdTTL: 3600, // 1h
    checkperiod: 600 
});

// ----------------------------------------------------------------

/**
 * Salva episodio (Hybrid Write: SQLite + ChromaDB via Axios)
 */
export async function saveEpisode(data) {
    const { 
        sessionId, location, weatherData, 
        pescaScore, pescaScorePredicted, aiAnalysis, userAction, userFeedback, outcome
    } = data;
    
    try {
        // 1. Genera embedding
        const episodeText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${aiAnalysis.substring(0, 200)}`;
        
        const embeddings = await getGeminiEmbeddings([episodeText], 'RETRIEVAL_DOCUMENT');
        const embedding = embeddings[0];
        const embeddingId = `ep_${sessionId}_${Date.now()}`; 

        if (!embedding) {
            logger.warn('[Memory] Embedding generation failed, skipping semantic storage.');
            // Continua comunque il salvataggio in SQLite
        }
        
        // 2. Insert in SQLite (dati strutturati) - Identico al codice originale
        const stmt = db.prepare(`
            INSERT INTO fishing_episodes (
                session_id, created_at, location_lat, location_lon, location_name,
                weather_json, pesca_score_final, pesca_score_predicted, 
                user_action, user_feedback, outcome, embedding_id, model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
            sessionId,
            Date.now(),
            location.lat,
            location.lon,
            location.name,
            JSON.stringify(weatherData),
            pescaScore,
            pescaScorePredicted || null,
            userAction || null,
            userFeedback || null,
            outcome || null,
            embedding ? embeddingId : null,
            process.env.ML_MODEL_VERSION || '1.0'
        );
        
        // 3. Insert in ChromaDB via AXIOS (Semantic search)
        if (embedding && isChromaReady) {
            await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/add`, {
                ids: [embeddingId],
                embeddings: [embedding],
                documents: [episodeText],
                metadatas: [{
                    session_id: sessionId,
                    location_name: location.name,
                    pesca_score: pescaScore,
                    created_at: Date.now(),
                    // Aggiungo anche l'ID di SQLite per futura coerenza
                    episode_id: result.lastInsertRowid 
                }]
            });
            logger.info(`[Memory] Episode saved on ChromaDB via Axios: ${embeddingId}`);
        } else if (embedding) {
            logger.warn('[Memory] ChromaDB not ready, episode saved to SQLite only.');
        } else {
            logger.warn(`[Memory] Episode saved to SQLite only (no embedding): ${result.lastInsertRowid}`);
        }
        
        // 4. Invalida hot cache
        hotCache.flushAll();
        
        return { 
            success: true, 
            episodeId: result.lastInsertRowid, 
            embeddingId: embedding ? embeddingId : null 
        };
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`[Memory] Save episode failed: ${errorMessage}`);
        throw error;
    }
}

/**
 * Cerca episodi simili (Hybrid Query: Gemini Embeddings -> ChromaDB via Axios -> SQLite)
 * VANTAGGIO: ChromaDB per similarità semantica + SQLite per filtri/dati completi
 */
export async function findSimilarEpisodes(currentConditions, limit = 5) {
    const { location, aiAnalysis, pescaScore } = currentConditions;
    
    // Chiave cache basata sulle condizioni di ricerca
    const cacheKey = `similar_${JSON.stringify({ location: location.name, pescaScore, limit }).slice(0, 100)}`; 
    
    // Check hot cache
    const cached = hotCache.get(cacheKey);
    if (cached) {
        logger.debug('[Memory] Similar episodes from hot cache');
        return cached;
    }
    
    if (!isChromaReady) {
        logger.warn('[Memory] ChromaDB not ready, cannot perform semantic search.');
        return [];
    }

    try {
        // 1. Genera embedding della query
        const conditionsText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${aiAnalysis.substring(0, 200)}`;
        
        const embeddings = await getGeminiEmbeddings([conditionsText], 'RETRIEVAL_QUERY');
        const queryEmbedding = embeddings[0];

        if (!queryEmbedding) {
            logger.error('[Memory] Query embedding generation failed.');
            return [];
        }
        
        // 2. Semantic search (ChromaDB via Axios)
        const response = await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/query`, {
            query_embeddings: [queryEmbedding],
            n_results: limit * 2, // Over-fetch per filtrare dopo
            include: ["metadatas", "distances"] // Non abbiamo bisogno dei documents, sono solo a scopo di debug in questo caso
        });
        
        const semanticResults = response.data;
        const embeddingIds = semanticResults.ids[0] || []; // Ids degli episodi trovati
        const distances = semanticResults.distances[0] || [];
        const metadatas = semanticResults.metadatas[0] || [];
        
        if (embeddingIds.length === 0) {
            logger.info('[Memory] Semantic search returned no results.');
            return [];
        }

        // 3. Retrieve full episodes from SQLite (filtro e recupero dati completi)
        const placeholders = embeddingIds.map(() => '?').join(',');
        
        const stmt = db.prepare(`
            SELECT * FROM fishing_episodes 
            WHERE embedding_id IN (${placeholders})
            AND user_feedback IS NOT NULL
            ORDER BY created_at DESC
            LIMIT ?
        `);
        
        const episodes = stmt.all(...embeddingIds, limit);
        
        // 4. Enrich con similarity scores e dati completi
        const enrichedEpisodes = episodes.map(ep => {
            const index = embeddingIds.indexOf(ep.embedding_id);
            const similarity = index !== -1 ? distances[index] : null;

            return {
                ...ep,
                similarity: similarity, // Chroma distance, più è basso, più è simile
                weather_data: JSON.parse(ep.weather_json)
            };
        });
        
        // Cache result
        hotCache.set(cacheKey, enrichedEpisodes);
        
        logger.info(`[Memory] Found ${enrichedEpisodes.length} similar episodes (Hybrid Query)`);
        return enrichedEpisodes;
        
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`[Memory] Find similar episodes failed: ${errorMessage}`);
        return [];
    }
}

/**
 * Recupera statistiche aggregate per zona (SQLite)
 * (Invariato)
 */
export function getZoneStats(lat, lon, radius = 0.1) {
    const stmt = db.prepare(`
        SELECT 
            AVG(pesca_score_final) as avg_score,
            AVG(user_feedback) as avg_feedback,
            COUNT(*) as total_sessions
        FROM fishing_episodes
        WHERE 
            location_lat BETWEEN ? AND ?
            AND location_lon BETWEEN ? AND ?
            AND user_feedback IS NOT NULL
    `);
    
    const stats = stmt.get(
        lat - radius, lat + radius,
        lon - radius, lon + radius
    );
    
    return stats;
}

/**
 * Cleanup Policy (SQLite + ChromaDB via Axios)
 */
export async function runCleanupPolicy() {
    logger.info('[Memory] 🧹 Cleanup policy started...');
    
    const RETENTION_DAYS = 90;
    const cutoffTimestamp = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    try {
        // 1. Identifica episodi vecchi (>90 giorni)
        const oldEpisodes = db.prepare(`
            SELECT embedding_id FROM fishing_episodes WHERE created_at < ?
        `).all(cutoffTimestamp);
        
        logger.info(`[Memory] Found ${oldEpisodes.length} episodes to archive`);
        
        // 2. Aggrega statistiche prima di cancellare (Invariato)
        const aggregationStmt = db.prepare(`
            INSERT OR REPLACE INTO aggregated_stats (
                location_zone, weather_pattern, avg_pesca_score, 
                avg_user_feedback, sample_count, last_updated
            )
            SELECT 
                ROUND(location_lat, 1) || ',' || ROUND(location_lon, 1) as location_zone,
                'pattern_' || (CAST(AVG(json_extract(weather_json, '$.temp')) AS INT) / 5) * 5 as weather_pattern,
                AVG(pesca_score_final) as avg_pesca_score,
                AVG(user_feedback) as avg_user_feedback,
                COUNT(*) as sample_count,
                ? as last_updated
            FROM fishing_episodes
            WHERE created_at < ?
            GROUP BY location_zone, weather_pattern
        `);
        
        aggregationStmt.run(Date.now(), cutoffTimestamp);
        
        // 3. Delete da ChromaDB via AXIOS
        const embeddingIds = oldEpisodes.map(ep => ep.embedding_id).filter(id => id != null);
        if (embeddingIds.length > 0 && isChromaReady) {
            await axios.post(`${CHROMA_API_URL}/collections/${COLLECTION_NAME}/delete`, { 
                ids: embeddingIds 
            });
            logger.info(`[Memory] Deleted ${embeddingIds.length} embeddings from ChromaDB via Axios.`);
        } else if (embeddingIds.length > 0) {
            logger.warn('[Memory] Could not delete embeddings from ChromaDB: service not ready.');
        }
        
        // 4. Delete da SQLite (Invariato)
        const deleteStmt = db.prepare(`
            DELETE FROM fishing_episodes WHERE created_at < ?
        `);
        const deleteResult = deleteStmt.run(cutoffTimestamp);
        
        // 5. VACUUM per recuperare spazio (Invariato)
        db.exec('VACUUM');
        
        logger.info(`[Memory] ✅ Cleanup completed: ${deleteResult.changes} episodes archived`);
        
        return {
            success: true,
            archived: deleteResult.changes,
            aggregated: oldEpisodes.length
        };
        
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        logger.error(`[Memory] Cleanup policy failed: ${errorMessage}`);
        throw error;
    }
}

/**
 * Inizializza il sistema di memoria
 */
export async function initMemoryEngine() {
    logger.info('[Memory] Initializing Memory Engine...');
    await initChroma();
    logger.info('[Memory] ✅ Memory Engine ready');
}

/**
 * Health check
 */
export function getMemoryHealth() {
    const episodeCount = db.prepare('SELECT COUNT(*) as count FROM fishing_episodes').get();
    const statsCount = db.prepare('SELECT COUNT(*) as count FROM aggregated_stats').get();
    
    return {
        episodic_memory: episodeCount.count,
        aggregated_stats: statsCount.count,
        hot_cache_keys: hotCache.keys().length,
        semantic_collection: isChromaReady ? 'connected' : 'disconnected'
    };
}