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

    // NUOVA Logica Vento (Modificata: Assegna punti in base anche alla Temp. Acqua)
    const isWaterWarm = waterTemp > 20;

    if (windSpeedKph > 5 && windSpeedKph <= 20) {
        // Vento moderato (5-20 km/h)
        if (isWaterWarm) {
            score += 1.5; // Molto positivo se acqua calda (>20°C)
            reasons.push({ icon: 'wind', text: "Vento moderato + Acqua Calda", points: "+1.5", type: "positive" });
        } else {
            score += 0.5; // Neutro/positivo se acqua fredda (<=20°C)
            reasons.push({ icon: 'wind', text: "Vento moderato + Acqua Fredda/Neutrale", points: "+0.5", type: "positive" });
        }
    } else if (windSpeedKph > 20 && windSpeedKph <= 30) {
        // Vento Forte (20-30 km/h) - Penalità minore
        score -= 0.5;
        reasons.push({ icon: 'wind', text: "Vento forte (20-30 km/h)", points: "-0.5", type: "negative" });
    } else if (windSpeedKph > 30) {
        // Vento troppo forte (>30 km/h) - Penalità maggiore
        score -= 2.0;
        reasons.push({ icon: 'wind', text: "Vento molto forte (>30 km/h)", points: "-2.0", type: "negative" });
    } else {
        // Vento debole (<=5 km/h)
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

    // Logica Mare (Wave Height) - NESSUNA MODIFICA
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

    // NUOVA Logica Temperatura Acqua (Modificata: Nuovi pesi per gli intervalli specifici)
    let waterTempPoints = 0.0;
    let waterTempText = "Temp. acqua N/D";
    let waterTempType = "neutral";

    if (waterTemp !== null && waterTemp !== undefined) {
        if (waterTemp < 10) {
            waterTempPoints = -1.5;
            waterTempText = "Temp. acqua troppo fredda (<10°C)";
            waterTempType = "negative";
        } else if (waterTemp >= 10 && waterTemp < 14) {
            waterTempPoints = 0.5;
            waterTempText = "Temp. acqua fresca (10-14°C)";
            waterTempType = "positive";
        } else if (waterTemp >= 14 && waterTemp <= 20) {
            waterTempPoints = 1.5; // Premio massimo per l'intervallo 14-20°C
            waterTempText = "Temp. acqua OTTIMALE (14-20°C)";
            waterTempType = "positive";
        } else if (waterTemp > 20 && waterTemp <= 23) {
            waterTempPoints = 1.0;
            waterTempText = "Temp. acqua calda (20-23°C)";
            waterTempType = "positive";
        } else if (waterTemp > 23 && waterTemp <= 26) {
            waterTempPoints = -2.5; // Penalità maggiore per temperature estreme >23°C
            waterTempText = "Temp. acqua troppo calda (>23°C)";
            waterTempType = "negative";
        } else {
             // waterTemp > 26 (molto calda)
            waterTempPoints = -3.0; 
            waterTempText = "Temp. acqua ESTREMA (>26°C)";
            waterTempType = "negative";
        }

        score += waterTempPoints;
        reasons.push({ 
            icon: 'water_temp', 
            text: waterTempText, 
            points: waterTempPoints >= 0 ? `+${waterTempPoints.toFixed(1)}` : waterTempPoints.toFixed(1), 
            type: waterTempType 
        });
    } else {
        reasons.push({ icon: 'water_temp', text: "Temp. acqua N/D", points: "+0.0", type: "neutral" });
    }


    // Logica Correnti (USA currentSpeedKn in Nodi) - NESSUNA MODIFICA
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