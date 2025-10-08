// /lib/domain/score.calculator.js
// Questo file è stato aggiornato per includere la logica delle correnti basata sui Nodi (kn),
// che è ora coerente con la logica principale di previsione.

function calculateHourlyPescaScore(params) {

    let score = 3.0;
    const reasons = [];
    
    // I parametri sono stati modificati: 
    // - currentVelocity (obsoleto) è stato sostituito da currentSpeedKn (in Nodi).
    const {
        pressure, trendPressione, windSpeedKph,
        isNewOrFullMoon, cloudCover, waveHeight, waterTemp, 
        currentSpeedKn, // Nuovo parametro (in Nodi)
        currentDirectionStr // Aggiunto per completezza, anche se non usato nel calcolo dei punti
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
    
    // Logica Mare (Wave Height)
    if (waveHeight !== null && waveHeight !== undefined) {
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
        reasons.push({ icon: 'waves', text: "Dati onde non disp.", points: "+0.0", type: "neutral" });
    }

    // Logica Temperatura Acqua
    if (waterTemp !== null && waterTemp !== undefined) {
        if (waterTemp >= 12 && waterTemp <= 20) {
            score += 1.0;
            reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" });
        } else if (waterTemp < 10 || waterTemp > 24) {
            score -= 1.0;
            reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" });
        } else {
            reasons.push({ icon: 'water_temp', text: "Temp. acqua neutra", points: "+0.0", type: "neutral" });
        }
    } else {
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
    }


    // Logica Correnti (AGGIORNATA: Usa currentSpeedKn in Nodi)
    let currentPoints = 0.0;
    let currentText = "Dati corrente non disp.";
    let currentType = "neutral";
    let currentIcon = "swap_horiz";

    // Verifica la presenza e la validità del nuovo parametro
    if (currentSpeedKn !== 'N/D' && currentSpeedKn !== null && currentSpeedKn !== undefined) {
        const speed = parseFloat(currentSpeedKn);
        
        if (speed > 0.3 && speed <= 0.8) {
            currentPoints = 1.0; currentText = "Corrente ideale (0.3-0.8 kn)"; currentType = "positive";
        } else if (speed > 0.8) {
            currentPoints = -1.0; currentText = "Corrente forte (>0.8 kn)"; currentType = "negative";
        } else {
            // Include speed <= 0.3 (debole/nulla)
            currentText = "Corrente debole/nulla"; 
        }
    } 
    
    score += currentPoints;
    reasons.push({ 
        icon: currentIcon, 
        text: currentText, 
        points: currentPoints >= 0 ? `+${currentPoints.toFixed(1)}` : currentPoints.toFixed(1), 
        type: currentType 
    });
    // FINE LOGICA CORRENTI AGGIORNATA
    
    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score))), 
        reasons: reasons
    };
}


module.exports = { calculateHourlyPescaScore };
