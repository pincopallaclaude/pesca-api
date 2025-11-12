// /api/submit-feedback.js

/**
 * Submit Feedback Endpoint
 * POST /api/submit-feedback
 * Permette agli utenti di dare feedback su analisi e predizioni
 */

import { saveEpisode } from '../lib/db/memory.engine.js';
import * as logger from '../lib/utils/logger.js'; // CORREZIONE

export default async function submitFeedbackHandler(req, res) {
  try {
    const {
      sessionId,
      location,
      weatherData,
      pescaScore,
      pescaScorePredicted,
      aiAnalysis,
      userFeedback, // Rating 1-5
      userAction,   // 'went_fishing', 'stayed_home', 'changed_location'
      outcome       // 'successful', 'poor', 'moderate'
    } = req.body;
    
    // Validazione
    if (!sessionId || !location || !weatherData || !userFeedback) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['sessionId', 'location', 'weatherData', 'userFeedback']
      });
    }
    
    if (userFeedback < 1 || userFeedback > 5) {
      return res.status(400).json({
        error: 'userFeedback must be between 1 and 5'
      });
    }
    
    // Salva episodio con feedback
    const result = await saveEpisode({
      sessionId,
      location,
      weatherData,
      pescaScore: pescaScore || null,
      pescaScorePredicted: pescaScorePredicted || null,
      aiAnalysis: aiAnalysis || '',
      userAction: userAction || 'unknown',
      userFeedback,
      outcome: outcome || null
    });
    
    logger.info(`[Feedback] User feedback received: ${userFeedback}/5 for session ${sessionId}`);
    
    return res.status(200).json({
      success: true,
      message: 'Feedback ricevuto, grazie!',
      episodeId: result.episodeId,
      learning_status: 'Data will be used for ML training in next cycle'
    });
    
  } catch (error) {
    logger.error('[Feedback] Submit failed:', error);
    return res.status(500).json({
      error: 'Failed to submit feedback',
      message: error.message
    });
  }
}