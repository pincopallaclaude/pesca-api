// /api/recommend-species.js

import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache } from '../lib/utils/cache.manager.js';

/**
 * POST /api/recommend-species
 * Endpoint per raccomandazioni specie-specifiche
 * 
 * Body:
 * {
 *   "species": "spigola",
 *   "location": "40.813,14.209"
 * }
 */
export default async function recommendSpecies(req, res) {
  const { species, location } = req.body;
  
  // Validazione input
  if (!species || !location) {
    return res.status(400).json({
      error: 'Campi obbligatori: species, location',
      example: {
        species: "spigola",
        location: "40.813,14.209"
      },
      availableSpecies: ['spigola', 'orata', 'serra', 'calamaro']
    });
  }
  
  try {
    console.log(`[API /recommend-species] Richiesta ${species} @ ${location}`);
    
    // Recupera dati meteo dalla cache
    const cacheKey = `forecast-data-v-refactored-${location}`;
    const weatherData = myCache.get(cacheKey);
    
    if (!weatherData) {
      console.log(`[API /recommend-species] ⚠️ Dati meteo non in cache`);
      return res.status(404).json({
        error: 'Dati meteo non disponibili per questa località',
        action: 'fetch_forecast_first',
        message: 'Chiama prima /api/forecast per ottenere i dati meteo',
        location: location
      });
    }
    
    console.log(`[API /recommend-species] ✅ Dati meteo trovati, chiamata MCP...`);
    
    // Chiama MCP tool per raccomandazioni specie-specifiche
    const result = await mcpClient.callTool('recommend_for_species', {
      species: species.toLowerCase().trim(),
      weatherData: weatherData,
      location: weatherData.location?.name || location,
    });
    
    console.log(`[API /recommend-species] ✅ Raccomandazioni generate`);
    
    // Ritorna raccomandazioni al client
    return res.status(200).json({
      species: species,
      location: weatherData.location?.name || location,
      recommendations: result.content[0].text,
      metadata: {
        compatibilityScore: result.metadata?.compatibilityScore,
        compatibilityLevel: result.metadata?.compatibilityLevel,
        warnings: result.metadata?.warnings,
        advantages: result.metadata?.advantages,
        documentsUsed: result.metadata?.documentsUsed,
        timingMs: result.metadata?.timingMs,
        generatedAt: result.metadata?.generatedAt,
      },
    });
    
  } catch (error) {
    console.error('[API /recommend-species] ❌ Errore:', error);
    return res.status(500).json({
      error: 'Errore generazione raccomandazioni',
      message: error.message,
      species: species,
      location: location,
    });
  }
}