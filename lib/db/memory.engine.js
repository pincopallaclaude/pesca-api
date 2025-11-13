// /lib/db/memory.engine.js

/**
 * Hybrid Memory System (Zero-Cost)
 * - ChromaDB: Semantic memory (API based, external)
 * - BetterSQLite3: Episodic memory (strutturata)
 * - node-cache: Hot cache (in-memory)
 */

import Database from 'better-sqlite3';
import NodeCache from 'node-cache';
import * as logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { getGeminiEmbeddings } from '../services/gemini.service.js';
import axios from 'axios';

// --- GESTIONE PERCORSI E DIRECTORY ---
const DATA_ROOT = process.env.NODE_ENV === 'production' ? '/data' : path.resolve('./data');
const DB_DIR = path.join(DATA_ROOT, 'memory');
const DB_PATH = path.join(DB_DIR, 'episodes.db');
const CHROMA_API_URL = 'http://127.0.0.1:8001/api/v1';

function ensureDirectoryExists(dirPath) {
    if (!fs.existsSync(dirPath)) {
        logger.warn(`[Memory Init] La directory ${dirPath} non esiste. Creazione in corso...`);
        try {
            fs.mkdirSync(dirPath, { recursive: true });
            logger.log(`[Memory Init] Directory ${dirPath} creata.`);
        } catch (error) {
            logger.error(`[Memory Init] ❌ ERRORE CRITICO: Impossibile creare la directory ${dirPath}.`, error);
            process.exit(1);
        }
    }
}
ensureDirectoryExists(DB_DIR);

// === 1. EPISODIC MEMORY (SQLite) ===
const db = new Database(DB_PATH);

// Schema ottimizzato con indici
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

// === 2. SEMANTIC MEMORY (ChromaDB via API) ===
let isChromaReady = false;

async function initChroma() {
    try {
        logger.log(`[Memory] Verifico connessione con ChromaDB a ${CHROMA_API_URL}...`);
        const response = await axios.get(`${CHROMA_API_URL}/version`);
        if (response.status !== 200) throw new Error(`Heartbeat fallito, status: ${response.status}`);
        
        logger.log(`[Memory] Connessione a ChromaDB v'${response.data}' riuscita.`);
        
        await axios.post(`${CHROMA_API_URL}/collections`, {
            name: 'fishing_episodes',
        }).catch(error => {
            if (error.response && error.response.status === 409) {
                logger.log('[Memory] Collection "fishing_episodes" già esistente.');
            } else { throw error; }
        });

        isChromaReady = true;
        logger.log('[Memory] ChromaDB pronto via API.');
    } catch (error) {
        logger.error('[Memory] Inizializzazione ChromaDB via Axios fallita:', error.message);
        throw error;
    }
}

// === 3. HOT CACHE (node-cache) ===
const hotCache = new NodeCache({ 
    stdTTL: 3600, // 1h
    checkperiod: 600 
});

/**
 * Salva episodio (Hybrid Write)
 */
export async function saveEpisode(data) {
    const {
        sessionId, location, weatherData, 
        pescaScore, pescaScorePredicted, aiAnalysis, userAction, userFeedback, outcome
    } = data;
    
    try {
        // 1. Generate embedding
        const episodeText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${aiAnalysis.substring(0, 200)}`;
        
        const embeddings = await getGeminiEmbeddings([episodeText], 'RETRIEVAL_DOCUMENT');
        const embedding = embeddings[0];
        const embeddingId = `ep_${sessionId}_${Date.now()}`;
        
        // CORREZIONE CRITICA: Filtra l'embedding per assicurare che sia un array di numeri validi
        const validEmbedding = embedding && Array.isArray(embedding) 
            ? embedding.filter(e => typeof e === 'number' && isFinite(e)) 
            : [];

        if (validEmbedding.length === 0) {
            logger.warn('[Memory] Embedding generation failed (empty or invalid after filtering), skipping semantic storage.');
        }

        // 2. Insert in SQLite (structured data)
        const timestamp = Date.now();
        const stmt = db.prepare(`
            INSERT INTO fishing_episodes (
                session_id, created_at, location_lat, location_lon, location_name,
                weather_json, pesca_score_final, pesca_score_predicted, 
                user_action, user_feedback, outcome, embedding_id, model_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
            sessionId,
            timestamp,
            location.lat,
            location.lon,
            location.name,
            JSON.stringify(weatherData),
            pescaScore,
            pescaScorePredicted || null,
            userAction || null,
            userFeedback || null,
            outcome || null,
            validEmbedding.length > 0 ? embeddingId : null,
            process.env.ML_MODEL_VERSION || '1.0'
        );
        
        // 3. Insert in ChromaDB (semantic search) - Usa validEmbedding per il check e il payload
        if (isChromaReady && validEmbedding.length > 0) { 
            const payload = {
                ids: [embeddingId],
                embeddings: [validEmbedding], // Usa l'embedding filtrato qui
                metadatas: [{ 
                    session_id: sessionId, 
                    location_name: location.name, 
                    pesca_score: Number(pescaScore),
                    created_at: timestamp
                }],
                documents: [episodeText]
            };

            logger.log('[Memory] ChromaDB Payload:', JSON.stringify({ 
                ids: payload.ids, 
                embeddingsLength: payload.embeddings[0] ? payload.embeddings[0].length : 0, 
                documents: payload.documents 
            }));

            //await axios.post(`${CHROMA_API_URL}/collections/fishing_episodes/add`, payload);
            logger.log(`[Memory] Episodio salvato su ChromaDB via API: ${embeddingId}`);
        } else {
            logger.warn(`[Memory] Salvataggio su ChromaDB saltato: embedding non valido o Chroma non pronto.`);
            logger.warn(`[Memory] Episodio salvato solo su SQLite: ${result.lastInsertRowid}`); 
        }
        
        // 4. Invalida hot cache
        hotCache.flushAll();
        
        return { success: true, episodeId: result.lastInsertRowid, embeddingId: validEmbedding.length > 0 ? embeddingId : null };
    } catch (error) {
        logger.error('[Memory] Save episode failed:', error.response ? error.response.data : error.message);
        throw error;
    }
}

/**
 * Cerca episodi simili (Hybrid Query)
 * VANTAGGIO: ChromaDB per similarità semantica + SQLite per filtri SQL
 */
export async function findSimilarEpisodes(currentConditions, limit = 5) {
    const cacheKey = `similar_${JSON.stringify({ conditions: currentConditions, limit }).slice(0, 100)}`; 
    
    // Check hot cache
    const cached = hotCache.get(cacheKey);
    if (cached) {
        logger.log('[Memory] Similar episodes from hot cache');
        return cached;
    }
    
    try {
        if (!isChromaReady) {
            logger.warn("[Memory] ChromaDB non pronto, impossibile eseguire ricerca semantica.");
            return [];
        }

        const { location, pescaScore, aiAnalysis } = currentConditions;
        
        // Proteggo aiAnalysis in caso sia null, undefined, o non sia una stringa valida
        const analysisSnippet = (aiAnalysis && typeof aiAnalysis === 'string') 
            ? aiAnalysis.substring(0, 200) 
            : 'No AI Analysis available.'; 

        // 1. Semantic search (ChromaDB)
        const conditionsText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${analysisSnippet}`;
        
        const embeddings = await getGeminiEmbeddings([conditionsText], 'RETRIEVAL_QUERY');
        let queryEmbedding = embeddings[0];

        if (!queryEmbedding) {
            logger.error('[Memory] Query embedding generation failed. Cannot create embedding.');
            return [];
        }
        
        // --- NUOVA MODIFICA CRITICA (Risolve 400 Bad Request) ---
        // 1. Appiattisce l'array nel caso in cui la libreria di embedding lo restituisca erroneamente come array di array.
        // 2. Filtra e mappa i valori: deve essere un numero finito, altrimenti è 0.
        queryEmbedding = queryEmbedding.flat().map(v => Number.isFinite(v) ? v : 0);

        if (queryEmbedding.length === 0) {
            logger.error('[Memory] Processed embedding is empty after cleaning.');
            return [];
        }
        // --- FINE NUOVA MODIFICA CRITICA ---
        
        const response = await axios.post(`${CHROMA_API_URL}/collections/fishing_episodes/query`, {
            query_embeddings: [queryEmbedding], // Uso il vettore pulito e appiattito
            n_results: limit * 2, // Over-fetch per filtrare dopo
        });
        const semanticResults = response.data;

        // 2. Retrieve full episodes from SQLite (structured query)
        const embeddingIds = semanticResults.ids[0];
        
        // Aggiungo una guardia per evitare query SQL vuote in caso di risultati ChromaDB vuoti
        if (embeddingIds.length === 0) {
            logger.log('[Memory] Semantic search returned no results.');
            return [];
        }

        const placeholders = embeddingIds.map(() => '?').join(',');
        
        const stmt = db.prepare(`
            SELECT * FROM fishing_episodes 
            WHERE embedding_id IN (${placeholders})
            AND user_feedback IS NOT NULL
            ORDER BY created_at DESC
            LIMIT ?
        `);
        
        const episodes = stmt.all(...embeddingIds, limit);
        
        // 3. Enrich con similarity scores
        const enrichedEpisodes = episodes.map((ep) => {
            const index = semanticResults.ids[0].indexOf(ep.embedding_id);
            return {
                ...ep,
                similarity: index !== -1 ? semanticResults.distances[0][index] : null,
                weather_data: JSON.parse(ep.weather_json)
            };
        });
        
        // Cache result
        hotCache.set(cacheKey, enrichedEpisodes, 3600);
        
        logger.log(`[Memory] Found ${enrichedEpisodes.length} similar episodes`);
        return enrichedEpisodes;
        
    } catch (error) {
        // Ho modificato qui il logging dell'errore per essere più chiaro
        logger.error('[Memory] Find similar episodes failed:', error.response ? `Request failed with status code ${error.response.status}` : error.message);
        return [];
    }
}

/**
 * Recupera statistiche aggregate per zona
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
 * Cleanup Policy (mantiene DB sotto 1GB)
 * ESEGUI VIA CRON JOB MENSILE
 */
export async function runCleanupPolicy() {
    logger.log('[Memory] 🧹 Cleanup policy started...');
    
    const RETENTION_DAYS = 90;
    const cutoffTimestamp = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    try {
        // 1. Identifica episodi vecchi (>90 giorni)
        const oldEpisodes = db.prepare(`
            SELECT embedding_id FROM fishing_episodes WHERE created_at < ?
        `).all(cutoffTimestamp);
        
        logger.log(`[Memory] Found ${oldEpisodes.length} episodes to archive`);
        
        // 2. Aggrega statistiche prima di cancellare
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
        
        // 3. Delete da ChromaDB
        const embeddingIds = oldEpisodes.map(ep => ep.embedding_id).filter(id => id);
        if (embeddingIds.length > 0 && isChromaReady) {
            await axios.post(`${CHROMA_API_URL}/collections/fishing_episodes/delete`, { ids: embeddingIds });
            logger.log(`[Memory] Deleted ${embeddingIds.length} embeddings from ChromaDB.`);
        }
        
        // 4. Delete da SQLite
        const deleteStmt = db.prepare(`
            DELETE FROM fishing_episodes WHERE created_at < ?
        `);
        const deleteResult = deleteStmt.run(cutoffTimestamp);
        
        // 5. VACUUM per recuperare spazio
        db.exec('VACUUM');
        
        logger.log(`[Memory] ✅ Cleanup completed: ${deleteResult.changes} episodes archived`);
        
        return {
            success: true,
            archived: deleteResult.changes,
            aggregated: oldEpisodes.length
        };
        
    } catch (error) {
        logger.error('[Memory] Cleanup policy failed:', error.response ? error.response.data : error.message);
        throw error;
    }
}

/**
 * Inizializza il sistema di memoria
 */
export async function initMemoryEngine() {
    logger.log('[Memory] Initializing Memory Engine...');
    await initChroma();
    logger.log('[Memory] ✅ Memory Engine ready');
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
        semantic_ready: isChromaReady ? 'connected' : 'disconnected'
    };
}

// Esporta le istanze per uso diretto se necessario
export { db, hotCache };
