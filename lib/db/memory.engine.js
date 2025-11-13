// FORCE-COMMIT-AGAIN
// /lib/db/memory.engine.js

/**
 * Hybrid Memory System (Zero-Cost)
 * - ChromaDB: Semantic memory (in-process, file-based)
 * - BetterSQLite3: Episodic memory (strutturata)
 * - node-cache: Hot cache (in-memory)
 */

import Database from 'better-sqlite3';
import { ChromaClient } from 'chromadb';
import NodeCache from 'node-cache';
import * as logger from '../utils/logger.js';

// === 1. EPISODIC MEMORY (SQLite) ===
const DB_PATH = process.env.NODE_ENV === 'production' 
  ? '/data/memory/episodes.db' 
  : './data/memory/episodes.db';

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

// === 2. SEMANTIC MEMORY (ChromaDB In-Process) ===
const CHROMA_PATH = process.env.NODE_ENV === 'production'
  ? '/data/memory/chroma'
  : './data/memory/chroma';

let chromaClient;
let episodesCollection;

async function initChroma() {
  try {
    chromaClient = new ChromaClient({ path: CHROMA_PATH });
    
    episodesCollection = await chromaClient.getOrCreateCollection({
      name: 'fishing_episodes',
      metadata: { description: 'Episodic memory for fishing sessions' }
    });
    
    logger.info('[Memory] ChromaDB episodes collection initialized');
  } catch (error) {
    logger.error('[Memory] ChromaDB init failed:', error);
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
    // 1. Generate embedding (delega al servizio Gemini)
    // Usiamo una versione concisa per l'embedding
    const episodeText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${aiAnalysis.substring(0, 200)}`;
    
    // MODIFICA: Uso la nuova funzione getGeminiEmbeddings con taskType 'RETRIEVAL_DOCUMENT'
    const { getGeminiEmbeddings } = await import('../services/gemini.service.js');
    const embeddings = await getGeminiEmbeddings([episodeText], 'RETRIEVAL_DOCUMENT');
    const embedding = embeddings[0]; // Prendiamo il primo (e unico) risultato

    if (!embedding) {
      logger.warn('[Memory] Embedding generation failed, skipping semantic storage.');
      // Continuiamo comunque il salvataggio in SQLite
    }

    const embeddingId = `ep_${sessionId}_${Date.now()}`;
    
    // 2. Insert in SQLite (structured data)
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
      embedding ? embeddingId : null, // Salviamo embeddingId solo se l'embedding è riuscito
      process.env.ML_MODEL_VERSION || '1.0'
    );
    
    // 3. Insert in ChromaDB (semantic search) - Solo se l'embedding è riuscito
    if (embedding && isChromaReady) { // Aggiunto controllo isChromaReady     
      const payload = {
        ids: [embeddingId],
        embeddings: [embedding],
        metadatas: [{
          session_id: sessionId,
          location_name: location.name,
          pesca_score: pescaScore,
          created_at: Date.now()
        }],
        documents: [episodeText]
      };
      
      await axios.post(`${CHROMA_API_URL}/collections/fishing_episodes/add`, payload);
      logger.log(`[Memory] Episodio salvato su ChromaDB via API: ${embeddingId}`);
    } else {
      logger.warn(`[Memory] Episode saved to SQLite only: ${result.lastInsertRowid}`);
    }
    
    // 4. Invalida hot cache
    hotCache.flushAll();
    
    return { success: true, episodeId: result.lastInsertRowid, embeddingId: embedding ? embeddingId : null };
  } catch (error) {
    logger.error('[Memory] Save episode failed:', error);
    throw error;
  }
}

/**
 * Cerca episodi simili (Hybrid Query)
 * VANTAGGIO: ChromaDB per similarità semantica + SQLite per filtri SQL
 */
export async function findSimilarEpisodes(currentConditions, limit = 5) {
  // Ho reso la chiave cache più specifica e robusta, come nell'OLD ma aggiungendo pescaScore e limit
  const cacheKey = `similar_${JSON.stringify({ conditions: currentConditions, limit }).slice(0, 100)}`; 
  
  // Check hot cache
  const cached = hotCache.get(cacheKey);
  if (cached) {
    logger.debug('[Memory] Similar episodes from hot cache');
    return cached;
  }
  
  try {
    const { location, weatherData, pescaScore, aiAnalysis } = currentConditions;
    
    // 1. Semantic search (ChromaDB)
    // Usiamo una versione concisa per la query
    const conditionsText = `Location: ${location.name}. Score: ${pescaScore}. Analysis: ${aiAnalysis.substring(0, 200)}`;
    
    // MODIFICA: Uso la nuova funzione getGeminiEmbeddings con taskType 'RETRIEVAL_QUERY'
    const { getGeminiEmbeddings } = await import('../services/gemini.service.js');
    const embeddings = await getGeminiEmbeddings([conditionsText], 'RETRIEVAL_QUERY');
    const queryEmbedding = embeddings[0]; // Prendiamo il primo (e unico) risultato

    if (!queryEmbedding) {
      logger.error('[Memory] Query embedding generation failed.');
      return [];
    }
    
    const semanticResults = await episodesCollection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit * 2 // Over-fetch per filtrare dopo
    });
    
    // 2. Retrieve full episodes from SQLite (structured query)
    const embeddingIds = semanticResults.ids[0];
    const placeholders = embeddingIds.map(() => '?').join(',');
    
    // Aggiungo una guardia per evitare query SQL vuote in caso di risultati ChromaDB vuoti
    if (embeddingIds.length === 0) {
      logger.info('[Memory] Semantic search returned no results.');
      return [];
    }

    const stmt = db.prepare(`
      SELECT * FROM fishing_episodes 
      WHERE embedding_id IN (${placeholders})
      AND user_feedback IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ?
    `);
    
    const episodes = stmt.all(...embeddingIds, limit);
    
    // 3. Enrich con similarity scores
    const enrichedEpisodes = episodes.map((ep, idx) => ({
      ...ep,
      similarity: semanticResults.distances[0][idx],
      weather_data: JSON.parse(ep.weather_json)
    }));
    
    // Cache result
    hotCache.set(cacheKey, enrichedEpisodes, 3600);
    
    logger.info(`[Memory] Found ${enrichedEpisodes.length} similar episodes`);
    return enrichedEpisodes;
    
  } catch (error) {
    logger.error('[Memory] Find similar episodes failed:', error);
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
  logger.info('[Memory] 🧹 Cleanup policy started...');
  
  const RETENTION_DAYS = 90;
  const cutoffTimestamp = Date.now() - (RETENTION_DAYS * 24 * 60 * 60 * 1000);
  
  try {
    // 1. Identifica episodi vecchi (>90 giorni)
    const oldEpisodes = db.prepare(`
      SELECT * FROM fishing_episodes WHERE created_at < ?
    `).all(cutoffTimestamp);
    
    logger.info(`[Memory] Found ${oldEpisodes.length} episodes to archive`);
    
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
    const embeddingIds = oldEpisodes.map(ep => ep.embedding_id).filter(id => id != null);
    if (embeddingIds.length > 0) {
      // Nota: la funzione delete di Chroma accetta una lista di ID
      await episodesCollection.delete({ ids: embeddingIds });
      logger.info(`[Memory] Deleted ${embeddingIds.length} embeddings from ChromaDB.`);
    }
    
    // 4. Delete da SQLite
    const deleteStmt = db.prepare(`
      DELETE FROM fishing_episodes WHERE created_at < ?
    `);
    const deleteResult = deleteStmt.run(cutoffTimestamp);
    
    // 5. VACUUM per recuperare spazio
    db.exec('VACUUM');
    
    logger.info(`[Memory] ✅ Cleanup completed: ${deleteResult.changes} episodes archived`);
    
    return {
      success: true,
      archived: deleteResult.changes,
      aggregated: oldEpisodes.length
    };
    
  } catch (error) {
    logger.error('[Memory] Cleanup policy failed:', error);
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
    semantic_collection: episodesCollection ? 'connected' : 'disconnected'
  };
}