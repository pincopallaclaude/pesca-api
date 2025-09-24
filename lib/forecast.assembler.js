// /lib/forecast.assembler.js

const { calculatePescaScore } = require('./domain/score.calculator');
const { calcolaFinestrePesca } = require('./domain/window.calculator');
const { convertWmoToWwoCode, degreesTo16PointDirection } = require('./utils/wmo_code_converter');
const { format, parseISO, it, capitalize, getMeteoIconFromCode, getSeaStateAcronym, formatTimeToHHMM } = require('./utils/formatter');

// Funzione helper per garantire che un valore sia un numero valido
const safeNum = (val, decimals = 1) => {
    const num = Number(val);
    return isNaN(num) ? 0 : parseFloat(num.toFixed(decimals));
};

function processAndAssemble(unifiedForecastData) {
    let previousDayData = null;
    const finalForecast = [];

    for (const day of unifiedForecastData) {
        if (!day || !day.date || !day.hourly || day.hourly.length < 5) {
            console.error('[ASSEMBLER-ERROR] Skipping day with malformed base data:', { date: day.date, hourlyCount: day.hourly?.length });
            continue;
        }

        let trendPressione = '→';
        if (previousDayData?.dailyPressure && day.dailyPressure) {
            if (day.dailyPressure < previousDayData.dailyPressure - 0.5) trendPressione = '↓';
            else if (day.dailyPressure > previousDayData.dailyPressure + 0.5) trendPressione = '↑';
        }

        const scoreData = calculatePescaScore({ /* ...params... */ });
        const highTides = day.tides?.[0]?.tide_data?.filter(t => t.tide_type === 'HIGH') ?? [];
        const lowTides = day.tides?.[0]?.tide_data?.filter(t => t.tide_type === 'LOW') ?? [];
        
        const { finestraMattino, finestraSera } = calcolaFinestrePesca(/* ...params... */);
        
        finalForecast.push({
            giornoNome: capitalize(format(parseISO(day.date), 'eee', { locale: it })),
            giornoData: format(parseISO(day.date), 'dd/MM'),
            meteoIcon: getMeteoIconFromCode(day.hourly[4]?.weatherCode),
            moon_phase: day.astronomy?.[0]?.moon_phase ?? 'N/A',
            alba: `☀️ ${formatTimeToHHMM(day.astronomy?.[0]?.sunrise)}`,
            tramonto: formatTimeToHHMM(day.astronomy?.[0]?.sunset),
            maree: `Alta: ${highTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')} | Bassa: ${lowTides.map(t => formatTimeToHHMM(t.tideTime)).join(', ')}`,
            temperaturaAvg: safeNum(day.dailyTempAvg, 0),
            temperaturaMax: safeNum(day.maxtempC, 1),
            temperaturaMin: safeNum(day.mintempC, 1),
            pressione: safeNum(day.dailyPressure, 0),
            umidita: safeNum(day.dailyHumidity, 0),
            trendPressione,
            ventoDati: `${safeNum(day.dailyWindSpeedKph / 1.852, 0)} kn ${day.hourly[4]?.winddir16Point ?? ''}`,
            pescaScoreData: scoreData,
            pescaScore: scoreData.displayScore,
            finestraMattino,
            finestraSera,
            acronimoMare: getSeaStateAcronym(day.hourly[4]?.swellHeight_m),
            temperaturaAcqua: safeNum(day.waterTempAvg, 0),
            velocitaCorrente: safeNum(day.currentVelocityAvg * 1.94384, 1),
            hourly: day.hourly,
        });
        
        previousDayData = day;
    }
    
    return finalForecast;
}


// Rinominiamo la vecchia 'assembleFinalForecast' per chiarezza.
module.exports = { combineStandardData, combineStormglassData, processAndAssemble };