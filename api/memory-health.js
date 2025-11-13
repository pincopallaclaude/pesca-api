// /api/memory-health.js

/**
 * Memory Health Endpoint
 * GET /api/memory-health
 * Restituisce lo stato del sistema di memoria
 */

import { getMemoryHealth } from '#lib/db/memory.engine.js';
import * as logger from '#lib/utils/logger.js';

export default async function memoryHealthHandler(req, res) {
  try {
    const health = getMemoryHealth();
    
    logger.debug('[API] Memory health check requested');
    
    return res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      memory: health
    });
    
  } catch (error) {
    logger.error('[API] Memory health check failed:', error);
    return res.status(500).json({
      error: 'Memory health check failed',
      message: error.message
    });
  }
}
