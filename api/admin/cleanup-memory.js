// /api/admin/cleanup-memory.js

/**
 * Memory Cleanup Endpoint (Admin Only)
 * GET /api/admin/cleanup-memory
 * Esegue la policy di cleanup per mantenere DB sotto 1GB
 */

import { runCleanupPolicy } from '../lib/db/memory.engine.js';
import logger from '../lib/utils/logger.js';

export default async function cleanupMemoryHandler(req, res) {
  // Autenticazione
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.ADMIN_TOKEN}`;
  
  if (!authHeader || authHeader !== expectedToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    logger.info('[Admin] Starting memory cleanup policy...');
    
    const result = await runCleanupPolicy();
    
    return res.status(200).json({
      success: true,
      message: 'Cleanup completed',
      details: result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('[Admin] Cleanup failed:', error);
    return res.status(500).json({
      error: 'Cleanup failed',
      message: error.message
    });
  }
}