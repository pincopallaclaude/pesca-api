function calculateHourlyPescaScore(params) {
    let score = 3.0;
    const reasons = [];
    
    // NOTA IMPORTANTE: Il parametro 'currentVelocity' in m/s viene SOSTITUITO dal più preciso
    // 'currentSpeedKn' in Nodi (kn), fornito dal modulo forecast-logic.js.
    const {
        pressure, trendPressione, windSpeedKph,
        isNewOrFullMoon, cloudCover, waveHeight, waterTemp, currentSpeedKn // Modificato da currentVelocity
    } = params;

    // Logica Pressione
    if (trendPressione === '↓') { 
        score += 1.5; 
        reasons.push({ icon: 'pressure_down', text: "Pressione in calo", points: "+1.5", type: "positive" }); 
    } else if (trendPressione === '↑') { 
        score -= 1.0; 
        reasons.push({ icon: 'pressure_up', text: "Pressione in aumento", points: "-1.0", type: "negative" }); 
    } else { 
        reasons.push({ icon: 'pressure', text: "Pressione stabile", points: "+0.0", type: "neutral" }); 
    }

    // Logica Vento
    if (windSpeedKph > 5 && windSpeedKph < 20) { 
        score += 1.0; 
        reasons.push({ icon: 'wind', text: "Vento ideale (5-20 km/h)", points: "+1.0", type: "positive" }); 
    } else if (windSpeedKph > 30) { 
        score -= 2.0; 
        reasons.push({ icon: 'wind', text: "Vento forte (>30 km/h)", points: "-2.0", type: "negative" }); 
    } else {
        reasons.push({ icon: 'wind', text: "Vento debole/variabile", points: "+0.0", type: "neutral" });
    }

    // Logica Luna
    if (isNewOrFullMoon) { 
        score += 1.0; 
        reasons.push({ icon: 'moon', text: "Luna Nuova o Piena", points: "+1.0", type: "positive" }); 
    } else { 
        reasons.push({ icon: 'moon', text: "Fase lunare neutra", points: "+0.0", type: "neutral" }); 
    }

    // Logica Nuvole
    if (cloudCover > 60) { 
        score += 1.0; 
        reasons.push({ icon: 'clouds', text: "Coperto >60%", points: "+1.0", type: "positive" }); 
    } else if (cloudCover < 20 && pressure > 1018) { 
        score -= 1.0; 
        reasons.push({ icon: 'clouds', text: "Sereno con alta pressione", points: "-1.0", type: "negative" }); 
    } else {
        reasons.push({ icon: 'clouds', text: "Nuvolosità neutra", points: "+0.0", type: "neutral" });
    }
    
    // Logica Mare (Onde)
    if (waveHeight !== null) {
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { 
            score += 2.0; 
            reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); 
        } else if (waveHeight > 1.25 && waveHeight <= 2.5) { 
            score += 1.0; 
            reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); 
        } else if (waveHeight < 0.5) { 
            score -= 1.0; 
            reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); 
        } else if (waveHeight > 2.5) { 
            score -= 2.0; 
            reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); 
        }
    } else {
        reasons.push({ icon: 'waves', text: "Dati sul mare non disponibili", points: "+0.0", type: "neutral" });
    }

    // Logica Temperatura Acqua
    if (waterTemp !== null) {
        if (waterTemp >= 12 && waterTemp <= 20) { 
            score += 1.0; 
            reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); 
        } else if (waterTemp < 10 || waterTemp > 24) { 
            score -= 1.0; 
            reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); 
        } else {
            reasons.push({ icon: 'water_temp', text: "Temperatura acqua neutra", points: "+0.0", type: "neutral" });
        }
    } else {
        reasons.push({ icon: 'water_temp', text: "Dati temperatura non disponibili", points: "+0.0", type: "neutral" });
    }

    // Logica Correnti (AGGIORNATA per usare Nodi e range ottimale)
    if (currentSpeedKn !== null) {
        if (currentSpeedKn >= 0.3 && currentSpeedKn <= 0.8) { 
            score += 1.0; 
            reasons.push({ icon: 'currents', text: "Corrente ideale (0.3-0.8 kn)", points: "+1.0", type: "positive" }); 
        } else if (currentSpeedKn > 0.8) { 
            score -= 1.0; 
            reasons.push({ icon: 'currents', text: "Correnti troppo forti (>0.8 kn)", points: "-1.0", type: "negative" }); 
        } else {
            reasons.push({ icon: 'currents', text: "Correnti deboli/neutre", points: "+0.0", type: "neutral" });
        }
    } else {
        reasons.push({ icon: 'currents', text: "Dati correnti non disponibili", points: "+0.0", type: "neutral" });
    }
    
    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score))),
        reasons: reasons
    };
}

module.exports = { calculateHourlyPescaScore };
