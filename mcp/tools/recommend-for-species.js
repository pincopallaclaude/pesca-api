// /mcp/tools/recommend-for-species.js

import { queryKnowledgeBase } from '../../lib/services/vector.service.js';
import { generateAnalysis as geminiGenerate } from '../../lib/services/gemini.service.js';
import * as logger from '../../lib/utils/logger.js'; // Importato il logger unificato

const SPECIES_RULES = {
    spigola: { name: 'Spigola (Dicentrarchus labrax)', optimalTemp: { min: 12, max: 20 }, optimalWind: { min: 5, max: 20 }, optimalWave: { min: 0.5, max: 1.5 }, techniques: ['spinning', 'surfcasting', 'bolognese'], lures: ['minnow', 'ondulante', 'grub', 'verme coreano'], hotspots: ['foci', 'scogliere', 'moli'], season: ['autunno', 'inverno', 'primavera'] },
    orata: { name: 'Orata (Sparus aurata)', optimalTemp: { min: 15, max: 24 }, optimalWind: { min: 0, max: 15 }, optimalWave: { min: 0, max: 1.0 }, techniques: ['surfcasting', 'feeder', 'bolognese'], lures: ['bibi', 'cannolicchio', 'granchio'], hotspots: ['spiagge', 'fondali sabbiosi'], season: ['primavera', 'estate', 'autunno'] },
    serra: { name: 'Serra (Pomatomus saltatrix)', optimalTemp: { min: 18, max: 24 }, optimalWind: { min: 10, max: 25 }, optimalWave: { min: 0.5, max: 2.0 }, techniques: ['spinning', 'traina'], lures: ['minnow', 'popper', 'wtd', 'ondulante'], hotspots: ['sotto costa', 'correnti', 'frangenti'], season: ['estate', 'autunno'] },
    calamaro: { name: 'Calamaro (Loligo vulgaris)', optimalTemp: { min: 14, max: 20 }, optimalWind: { min: 0, max: 15 }, optimalWave: { min: 0, max: 1.0 }, techniques: ['eging', 'totanara'], lures: ['egi', 'totanara luminosa'], hotspots: ['moli', 'porti', 'secche'], season: ['autunno', 'inverno', 'primavera'], nightFishing: true },
};

export async function recommendForSpecies({ species, weatherData, location }) {
    const startTime = Date.now();
    try {
        const speciesKey = species.toLowerCase().trim();
        logger.log(`[MCP Species] 🐟 Raccomandazioni per: ${speciesKey} @ ${location}`);
        
        const speciesRules = SPECIES_RULES[speciesKey];
        if (!speciesRules) {
            logger.warn(`[MCP Species] ⚠️ Specie "${speciesKey}" non in database, fallback AI`);
            return await generateGenericSpeciesRecommendation(species, weatherData, location);
        }

        const compatibility = assessCompatibility(weatherData, speciesRules);
        logger.log(`[MCP Species] 📊 Compatibilità: ${compatibility.score}/100`);
        
        // === STEP 3: RAG con RE-RANKING - Cerca conoscenza specifica per la specie ===
        logger.log(`[MCP Species] 🔍 Eseguo query RAG per specie: ${speciesKey} con re-ranking attivato...`);
        // Query semplificata per massimizzare la rilevanza RAG
        const kbQuery = `pesca ${speciesKey} tecniche esche spot consigli per ${location}`; 

        const relevantDocs = await queryKnowledgeBase(kbQuery, {
            topK: 4,        // Vogliamo 4 documenti finali, i più pertinenti.
            filters: { species: [speciesKey] },
            useReranking: true,   // 🔥 ATTIVA IL RE-RANKING DI PRECISIONE
            rerankTopK: 10        // Recupera 10 candidati specifici per la specie.
        });
        
        logger.log(`[MCP Species] 📚 Trovati ${relevantDocs.length} documenti KB`);

        // Utilizziamo solo il campo 'content' dal risultato aggiornato di queryKnowledgeBase
        const docsForPrompt = relevantDocs.map(d => d.content);
        logger.log(`[MCP Species] 📖 Utilizzati ${docsForPrompt.length} contesti arricchiti per il prompt.`);

        const prompt = buildSpeciesPrompt(species, speciesRules, weatherData, location, compatibility, docsForPrompt);
        const recommendations = await geminiGenerate(prompt);
        
        const elapsed = Date.now() - startTime;
        logger.log(`[MCP Species] 🏁 Completato in ${elapsed}ms`);

        return {
            content: [{ type: 'text', text: recommendations }],
            metadata: { species: speciesRules.name, compatibilityScore: compatibility.score, compatibilityLevel: compatibility.level, warnings: compatibility.warnings, advantages: compatibility.advantages, documentsUsed: relevantDocs.length, timingMs: elapsed, generatedAt: new Date().toISOString() }
        };
    } catch (error) {
        logger.error(`[MCP Species] ❌ Errore: ${error.message}`);
        throw new Error(`Species recommendation failed: ${error.message}`);
    }
}

function assessCompatibility(weatherData, rules) {
    let score = 100;
    const warnings = [];
    const advantages = [];
    
    // SAFE DEFAULTS - usa dati aggregati se hourly non disponibile
    let waterTemp, windSpeed, waveHeight;

    const hourlyData = weatherData.hourly || [];
    if (hourlyData.length > 0) {
        // Calcola le medie dai dati orari se disponibili (comportamento originale)
        waterTemp = hourlyData.reduce((sum, h) => sum + h.waterTemperature, 0) / hourlyData.length;
        // La velocità del vento viene convertita in km/h se i dati orari sono disponibili
        windSpeed = hourlyData.reduce((sum, h) => sum + h.windSpeedKn * 1.852, 0) / hourlyData.length;
        waveHeight = hourlyData.reduce((sum, h) => sum + h.waveHeight, 0) / hourlyData.length;
    } else {
        // Fallback ai dati aggregati come richiesto
        waterTemp = weatherData.seaTemp || weatherData.avgTemp || 18;
        windSpeed = weatherData.dailyWindSpeedKn || weatherData.wind?.speed || weatherData.avgWind || 10;
        waveHeight = weatherData.sea?.waveHeight || weatherData.avgWave || 0.5;
        
        warnings.push('Valutazione basata su dati aggregati/di fallback anziché orari dettagliati.');
    }
    
    // Valutazione Temperatura Acqua
    if (waterTemp < rules.optimalTemp.min || waterTemp > rules.optimalTemp.max) { 
        score -= 20; 
        warnings.push(`Temperatura acqua ${waterTemp.toFixed(1)}°C fuori range (${rules.optimalTemp.min}-${rules.optimalTemp.max}°C)`); 
    } else { 
        advantages.push(`Temperatura acqua ottimale: ${waterTemp.toFixed(1)}°C`); 
    }

    // Valutazione Vento (Assumendo che windSpeed sia in km/h o nodi compatibili con le regole)
    if (windSpeed < rules.optimalWind.min || windSpeed > rules.optimalWind.max) { 
        score -= 15; 
        warnings.push(`Vento ${windSpeed.toFixed(1)}km/h non ideale (${rules.optimalWind.min}-${rules.optimalWind.max}km/h)`); 
    } else { 
        advantages.push(`Vento favorevole: ${windSpeed.toFixed(1)}km/h`); 
    }

    // Valutazione Mare
    if (waveHeight < rules.optimalWave.min || waveHeight > rules.optimalWave.max) { 
        score -= 15; 
        warnings.push(`Mare ${waveHeight.toFixed(1)}m non ottimale (${rules.optimalWave.min}-${rules.optimalWave.max}m)`); 
    } else { 
        advantages.push(`Stato mare ideale: ${waveHeight.toFixed(1)}m`); 
    }

    let level;
    if (score >= 80) level = 'excellent';
    else if (score >= 60) level = 'good';
    else if (score >= 40) level = 'fair';
    else level = 'poor';
    return { score, level, warnings, advantages };
}

function buildSpeciesPrompt(species, rules, weatherData, location, compatibility, relevantDocs) {
    // Sostituito il calcolo con il fallback come richiesto.
    const waterTemp = weatherData.seaTemp || weatherData.avgTemp || 18;

    return `
# Raccomandazioni Pesca: ${rules.name} a ${location}
## Compatibilità Condizioni: ${compatibility.level.toUpperCase()} (${compatibility.score}/100)
### ✅ Vantaggi:
${compatibility.advantages.map(a => `- ${a}`).join('\n')}
### ⚠️ Fattori Critici:
${compatibility.warnings.length > 0 ? compatibility.warnings.map(w => `- ${w}`).join('\n') : '- Nessuno'}
## Dati Chiave
- Temp Acqua: ${waterTemp.toFixed(1)}°C
- Vento: ${weatherData.ventoDati}
- Mare: ${weatherData.mare}
- Luna: ${weatherData.moonPhase}
- Maree: ${weatherData.maree}
## Conoscenza dalla KB
${relevantDocs.map((doc, i) => `### Insight ${i+1}\n${doc}`).join('\n')}
## Istruzioni
Genera raccomandazioni ULTRA-SPECIFICHE per ${rules.name}.
Struttura OBBLIGATORIA:
1. **Valutazione Compatibilità**: Analisi pro/contro.
2. **Tattica Raccomandata**: La MIGLIORE tecnica tra ${rules.techniques.join(', ')} e perché.
3. **Setup Attrezzatura**: Esca/Artificiale (da ${rules.lures.join(', ')}), montatura, canna/mulinello.
4. **Strategia di Pesca**: Azione, recupero, spot da cercare (basato su ${rules.hotspots.join(', ')}).
5. **Orari Ottimali**: Finestre migliori oggi.
${compatibility.score < 60 ? '6. **Alternative**: Suggerisci specie alternative più adatte oggi.' : ''}
Stile: Pratico, diretto. Usa Markdown.
`;
}

async function generateGenericSpeciesRecommendation(species, weatherData, location) {
    const speciesKey = species.toLowerCase().trim();
    // Uso il nuovo formato queryKnowledgeBase con filtri e re-ranking
    const kbQuery = `pesca ${speciesKey} tecniche esche`;
    const relevantDocs = await queryKnowledgeBase(kbQuery, {
        topK: 3,
        filters: { species: [speciesKey] },
        useReranking: true,
        rerankTopK: 10
    });
    
    // Uso d.content per estrarre il testo dal nuovo formato
    const docsForPrompt = relevantDocs.map(d => d.content);

    const prompt = `
# Raccomandazioni Pesca: ${species}
Genera raccomandazioni per la pesca di ${species} a ${location} con queste condizioni:
${JSON.stringify({vento: weatherData.ventoDati, mare: weatherData.mare, luna: weatherData.moonPhase}, null, 2)}
Conoscenza disponibile:
${docsForPrompt.join('\n\n')}
Includi: tecniche, esche, orari, spot. Stile pratico e specifico.`;
    const recommendations = await geminiGenerate(prompt);
    return { content: [{ type: 'text', text: recommendations }], metadata: { species, fallback: true, message: 'Specie non in database regole, generazione AI generica' }};
}