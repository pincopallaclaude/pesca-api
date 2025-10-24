// /lib/domain/score.calculator.js

// Questo file è stato aggiornato per includere la logica delle correnti basata sui Nodi (kn),
// che è ora coerente con la logica principale di previsione.

/**
 * [MASTER VERSION] Calcola il punteggio orario di pescabilità.
 * @param {object} params - Parametri orari.
 * @param {boolean} [shouldLog=false] - Se stampare o meno il log di debug.
 * @returns {{numericScore: number, displayScore: number, reasons: Array<object>}}
 */
function calculateHourlyPescaScore(params, shouldLog = false) {

    let score = 3.0;
    const reasons = [];

    const {
        pressure, trendPressione, windSpeedKph,
        isNewOrFullMoon, moonPhase,
        cloudCover, waveHeight, waterTemp,
        currentSpeedKn, 
        currentDirectionStr,
        hour
    } = params;
    
    // [FINAL DEBUG LOGIC] This is the logging block that must be executed.
    if (shouldLog) {
        // Helper function for logging, kept local to this debug block.
        const getStatusLabel = (value) => {
            if (typeof value === 'string' && (value.trim().toUpperCase() === 'N/D' || value.trim() === '' || value.trim() === '→')) return 'N/D';
            if (typeof value === 'string' && (value.trim() === '↓' || value.trim() === '↑')) return 'SI';
            if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) return 'NO';
            return 'SI';
        };

        const pressureStatus = getStatusLabel(pressure);
        const trendStatus = getStatusLabel(trendPressione);
        const windStatus = getStatusLabel(windSpeedKph);
        const cloudStatus = getStatusLabel(cloudCover);
        const waveStatus = getStatusLabel(waveHeight);
        const tempWaterStatus = getStatusLabel(waterTemp);
        const currentStatus = (currentSpeedKn === 'N/D') ? 'N/D' : getStatusLabel(currentSpeedKn);
        const currentDirStatus = (currentDirectionStr === 'N/D') ? 'N/D' : getStatusLabel(currentDirectionStr);
        let moonLogStatus = isNewOrFullMoon ? 'SI' : (moonPhase ? `NO (${moonPhase})` : 'NO');
        
        console.log(`\n======================================================`);
        console.log(`[Score Calc DEBUG] Parametri Ricevuti per il calcolo (Prima Ora):`);
        console.log(`  - Pressione/Trend: ${pressureStatus} / ${trendStatus}`);
        console.log(`  - Vento: ${windStatus}`);
        console.log(`  - Nuvolosità: ${cloudStatus}`);
        console.log(`  - Onde (WaveHeight): ${waveStatus}`);
        console.log(`  - Temp Acqua: ${tempWaterStatus}`);
        console.log(`  - Corrente (Speed/Dir): ${currentStatus} / ${currentDirStatus}`);
        console.log(`  - Luna (Fase Critica): ${moonLogStatus}`);
        console.log(`======================================================\n`);
    }


    // --- LA TUA LOGICA DI BUSINESS RIMANE ASSOLUTAMENTE INVARIATA ---

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
    const isWaterWarm = waterTemp > 20;
    if (windSpeedKph > 5 && windSpeedKph <= 20) {
        if (isWaterWarm) {
            score += 1.5; 
            reasons.push({ icon: 'wind', text: "Vento moderato + Acqua Calda", points: "+1.5", type: "positive" });
        } else {
            score += 0.5;
            reasons.push({ icon: 'wind', text: "Vento moderato + Acqua Fredda/Neutrale", points: "+0.5", type: "positive" });
        }
    } else if (windSpeedKph > 20 && windSpeedKph <= 30) {
        score -= 0.5;
        reasons.push({ icon: 'wind', text: "Vento forte (20-30 km/h)", points: "-0.5", type: "negative" });
    } else if (windSpeedKph > 30) {
        score -= 2.0;
        reasons.push({ icon: 'wind', text: "Vento molto forte (>30 km/h)", points: "-2.0", type: "negative" });
    } else {
        reasons.push({ icon: 'wind', text: "Vento debole/assente", points: "+0.0", type: "neutral" });
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
        if (waveHeight >= 0.5 && waveHeight <= 1.25) { score += 2.0; reasons.push({ icon: 'waves', text: "Mare poco mosso (0.5-1.25m)", points: "+2.0", type: "positive" }); } 
        else if (waveHeight > 1.25 && waveHeight <= 2.5) { score += 1.0; reasons.push({ icon: 'waves', text: "Mare mosso (1.25-2.5m)", points: "+1.0", type: "positive" }); } 
        else if (waveHeight < 0.5) { score -= 1.0; reasons.push({ icon: 'waves', text: "Mare calmo (<0.5m)", points: "-1.0", type: "negative" }); } 
        else if (waveHeight > 2.5) { score -= 2.0; reasons.push({ icon: 'waves', text: "Mare agitato (>2.5m)", points: "-2.0", type: "negative" }); }
    } else {
        reasons.push({ icon: 'waves', text: "Dati onde non disp.", points: "+0.0", type: "neutral" });
    }

    // Logica Temperatura Acqua
    let waterTempPoints = 0.0;
    let waterTempText = "Temp. acqua N/D";
    let waterTempType = "neutral";
    if (waterTemp !== null && waterTemp !== undefined) {
        if (waterTemp < 10) { waterTempPoints = -1.5; waterTempText = "Temp. acqua troppo fredda (<10°C)"; waterTempType = "negative"; } 
        else if (waterTemp >= 10 && waterTemp < 14) { waterTempPoints = 0.5; waterTempText = "Temp. acqua fresca (10-14°C)"; waterTempType = "positive"; } 
        else if (waterTemp >= 14 && waterTemp <= 20) { waterTempPoints = 1.5; waterTempText = "Temp. acqua OTTIMALE (14-20°C)"; waterTempType = "positive"; } 
        else if (waterTemp > 20 && waterTemp <= 23) { waterTempPoints = 1.0; waterTempText = "Temp. acqua calda (20-23°C)"; waterTempType = "positive"; } 
        else if (waterTemp > 23 && waterTemp <= 26) { waterTempPoints = -2.5; waterTempText = "Temp. acqua troppo calda (>23°C)"; waterTempType = "negative"; } 
        else { waterTempPoints = -3.0; waterTempText = "Temp. acqua ESTREMA (>26°C)"; waterTempType = "negative"; }
        score += waterTempPoints;
        reasons.push({ icon: 'water_temp', text: waterTempText, points: `${waterTempPoints >= 0 ? '+' : ''}${waterTempPoints.toFixed(1)}`, type: waterTempType });
    } else {
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
    }

    // Logica Correnti
    let currentPoints = 0.0;
    let currentText = "Dati corrente non disp.";
    let currentType = "neutral";
    let currentIcon = "swap_horiz";
    if (currentSpeedKn !== 'N/D' && currentSpeedKn !== null && currentSpeedKn !== undefined) {
        const speed = parseFloat(currentSpeedKn);
        if (speed > 0.3 && speed <= 0.8) { currentPoints = 1.0; currentText = "Corrente ideale (0.3-0.8 kn)"; currentType = "positive"; } 
        else if (speed > 0.8) { currentPoints = -1.0; currentText = "Corrente forte (>0.8 kn)"; currentType = "negative"; } 
        else { currentText = "Corrente debole/nulla"; }
    }
    score += currentPoints;
    reasons.push({ icon: currentIcon, text: currentText, points: `${currentPoints >= 0 ? '+' : ''}${currentPoints.toFixed(1)}`, type: currentType });

    return {
        numericScore: score,
        displayScore: Math.min(5, Math.max(1, Math.round(score))),
        reasons: reasons
    };
}


export { calculateHourlyPescaScore };