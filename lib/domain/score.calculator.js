// /lib/domain/score.calculator.js

function calculatePescaScore(params) {
    let score = 3.0;
    const reasons = [];
    const {
        trendPressione,
        dailyWindSpeedKph,
        prevWindSpeed,
        isNewOrFullMoon,
        avgCloudCover,
        dailyPressure,
        waveHeightMax,
        prevWaveHeightMax,
        waterTempAvg,
        currentVelocityAvg,
        prevCurrentVelocityAvg
    } = params;
    
    // Logica Pressione
    if (trendPressione === '↓') { score += 1.5; reasons.push({ icon: 'pressure_down', text: "Pressione in calo", points: "+1.5", type: "positive" }); }
    else if (trendPressione === '↑') { score -= 1.0; reasons.push({ icon: 'pressure_up', text: "Pressione in aumento", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'pressure', text: "Pressione stabile", points: "+0.0", type: "neutral" }); }

    // Logica Vento
    if (prevWindSpeed && prevWindSpeed > 30 && dailyWindSpeedKph < prevWindSpeed) { score += 2.0; reasons.push({ icon: 'wind', text: "Vento in calo da burrasca", points: "+2.0", type: "positive" }); }
    else if (dailyWindSpeedKph > 5 && dailyWindSpeedKph < 20) { score += 1.0; reasons.push({ icon: 'wind', text: "Vento ideale (5-20 km/h)", points: "+1.0", type: "positive" }); }
    else if (dailyWindSpeedKph > 30) { score -= 2.0; reasons.push({ icon: 'wind', text: "Vento forte (>30 km/h)", points: "-2.0", type: "negative" }); }
    else { reasons.push({ icon: 'wind', text: "Vento debole/variabile", points: "+0.0", type: "neutral" }); }

    // Logica Luna
    if (isNewOrFullMoon) { score += 1.0; reasons.push({ icon: 'moon', text: "Luna Nuova o Piena", points: "+1.0", type: "positive" }); }
    else { reasons.push({ icon: 'moon', text: "Fase lunare neutra", points: "+0.0", type: "neutral" }); }

    // Logica Nuvole
    if (avgCloudCover > 60) { score += 1.0; reasons.push({ icon: 'clouds', text: "Coperto >60%", points: "+1.0", type: "positive" }); }
    else if (avgCloudCover < 20 && dailyPressure > 1018) { score -= 1.0; reasons.push({ icon: 'clouds', text: "Sereno con alta pressione", points: "-1.0", type: "negative" }); }
    else { reasons.push({ icon: 'clouds', text: "Nuvolosità neutra", points: "+0.0", type: "neutral" }); }

    // Logica Mare
    if (waveHeightMax !== null) {
        if (prevWaveHeightMax && (waveHeightMax < prevWaveHeightMax) && prevWaveHeightMax > 2.5) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare in scaduta", points: "+2.0", type: "positive" }); }
        else if (waveHeightMax >= 0.5 && waveHeightMax <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); }
        else if (waveHeightMax > 1.25 && waveHeightMax <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); }
        else if (waveHeightMax < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); }
        else if (waveHeightMax > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    }

    // Logica Temperatura Acqua
    if (waterTempAvg !== null) {
        if (waterTempAvg >= 12 && waterTempAvg <= 20) { score += 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua ideale (12-20°C)", points: "+1.0", type: "positive" }); }
        else if (waterTempAvg < 10 || waterTempAvg > 24) { score -= 1.0; reasons.push({ icon: 'water_temp', text: "Temp. acqua estrema", points: "-1.0", type: "negative" }); }
        else { reasons.push({ icon: 'water_temp', text: "Temperatura acqua neutra", points: "+0.0", type: "neutral" }); }
    }

    // Logica Correnti
    if (currentVelocityAvg !== null) {
        if (prevCurrentVelocityAvg) {
            if ((prevCurrentVelocityAvg - currentVelocityAvg) > 0.1) { score += 1.0; reasons.push({ icon: 'currents', text: "Correnti in calo significativo", points: "+1.0", type: "positive" }); }
            else if ((currentVelocityAvg - prevCurrentVelocityAvg) > 0.1) { score += 0.5; reasons.push({ icon: 'currents', text: "Correnti in aumento", points: "+0.5", type: "positive" }); }
        }
        if (currentVelocityAvg > 1) { score -= 1.0; reasons.push({ icon: 'currents', text: "Correnti troppo forti (>1 m/s)", points: "-1.0", type: "negative" }); }
    }
    
    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score))),
        reasons: reasons
    };
}

module.exports = { calculatePescaScore };