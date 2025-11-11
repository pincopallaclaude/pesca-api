// /api/admin/export-episodes.js

/**
 * Export Episodes Endpoint (Admin Only)
 * GET /api/admin/export-episodes
 * Esporta tutti gli episodi con feedback per il training ML
 */

import Database from 'better-sqlite3';
import logger from '../lib/utils/logger.js';

const DB_PATH = process.env.NODE_ENV === 'production' 
  ? '/data/memory/episodes.db' 
  : './data/memory/episodes.db';

export default async function exportEpisodesHandler(req, res) {
  // Autenticazione semplice (migliora in produzione!)
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.ADMIN_TOKEN}`;
  
  if (!authHeader || authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const db = new Database(DB_PATH, { readonly: true });
    
    // Esporta solo episodi con feedback (per training)
    const episodes = db.prepare(`
      SELECT * FROM fishing_episodes 
      WHERE user_feedback IS NOT NULL
      ORDER BY created_at DESC
    `).all();
    
    logger.info(`[Admin] Exported ${episodes.length} episodes for training`);
    
    return res.status(200).json({
      episodes: episodes,
      count: episodes.length,
      exported_at: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Admin] Export failed:', error);
    return res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
}
