// /api/recommend-species.js

import { mcpClient } from '../lib/services/mcp-client.service.js';
import { myCache } from '../lib/utils/cache.manager.js';

export default async function recommendSpecies(req, res) {
  // 🔥 MODIFICA: Accetta anche lat/lon opzionali
  const { species, location, lat, lon } = req.body;
  
  if (!species || !location) {
    return res.status(400).json({
      error: 'Campi obbligatori: species, location. Campi opzionali: lat, lon',
      example: {
        species: "spigola",
        location: "Posillipo",
        lat: 40.813,
        lon: 14.208
      },
      availableSpecies: ['spigola', 'orata', 'serra', 'calamaro']
    });
  }
  
  try {
    // ==========================================================
    // 🔥 NUOVA LOGICA: Costruzione coerente della cacheKey 🔥
    // ==========================================================
    let cacheLocationKey;
    if (lat && lon) {
        // Se lat/lon sono forniti (come fa l'app), usa quelli con la stessa precisione
        cacheLocationKey = `${parseFloat(lat).toFixed(3)},${parseFloat(lon).toFixed(3)}`;
        console.log(`[API /recommend-species] Richiesta ${species} @ ${location} (usando coordinate ${cacheLocationKey})`);
    } else {
        // Altrimenti, usa il nome (per test semplici)
        cacheLocationKey = location;
        console.log(`[API /recommend-species] Richiesta ${species} @ ${location}`);
    }
    const cacheKey = `forecast-data-v-refactored-${cacheLocationKey}`;
    // ==========================================================
    
    const weatherData = myCache.get(cacheKey);
    
    if (!weatherData) {
      console.log(`[API /recommend-species] ⚠️ Dati meteo non in cache per la chiave: ${cacheKey}`);
      return res.status(404).json({
        error: 'Dati meteo non disponibili per questa località',
        action: 'fetch_forecast_first',
        message: 'Chiama prima /api/forecast per ottenere i dati meteo',
        location: location
      });
    }
    
    console.log(`[API /recommend-species] ✅ Dati meteo trovati, chiamata MCP...`);
    
    const result = await mcpClient.callTool('recommend_for_species', {
      species: species.toLowerCase().trim(),
      weatherData: weatherData.forecast, // 🔥 MODIFICA: Passa l'oggetto forecast interno
      location: weatherData.forecast[0].location?.name || location,
    });
    
    console.log(`[API /recommend-species] ✅ Raccomandazioni generate`);
    
    return res.status(200).json({
      species: species,
      location: weatherData.forecast[0].location?.name || location,
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