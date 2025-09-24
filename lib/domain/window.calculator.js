// /lib/domain/window.calculator.js
const { formatTimeToHHMM } = require('../utils/formatter');

function timeToHours(timeStr) {
    const [hours, minutes] = formatTimeToHHMM(timeStr).split(':');
    return parseInt(hours) + parseInt(minutes) / 60;
}

function calcolaFinestrePesca(sunrise, sunset, highTides, lowTides, score) {
    if (score <= 2) {
        return { finestraMattino: { orario: "Sconsigliato" }, finestraSera: { orario: "Sconsigliato" } };
    }

    const eventi = {
        alba: { ora: timeToHours(sunrise), peso: 10, tipo: "Alba" },
        tramonto: { ora: timeToHours(sunset), peso: 10, tipo: "Tramonto" }
    };

    let pesoMarea = score >= 4 ? 10 : 7;
    const mareeMattino = [...highTides, ...lowTides]
        .filter(t => timeToHours(t.tideTime) < 14)
        .sort((a,b) => Math.abs(timeToHours(a.tideTime) - eventi.alba.ora) - Math.abs(timeToHours(b.tideTime) - eventi.alba.ora));
        
    const mareeSera = [...highTides, ...lowTides]
        .filter(t => timeToHours(t.tideTime) >= 14)
        .sort((a,b) => Math.abs(timeToHours(a.tideTime) - eventi.tramonto.ora) - Math.abs(timeToHours(b.tideTime) - eventi.tramonto.ora));

    let eventoTopMattino = eventi.alba;
    if (mareeMattino.length > 0) {
        const mareaTopMattino = mareeMattino[0];
        if (pesoMarea > eventoTopMattino.peso || Math.abs(eventi.alba.ora - timeToHours(mareaTopMattino.tideTime)) < 2) {
            eventoTopMattino = { ora: timeToHours(mareaTopMattino.tideTime), peso: pesoMarea, tipo: `${mareaTopMattino.tide_type === 'HIGH' ? 'Alta' : 'Bassa'} Marea` };
        }
    }

    let eventoTopSera = eventi.tramonto;
    if (mareeSera.length > 0) {
        const mareaTopSera = mareeSera[0];
        if (pesoMarea > eventoTopSera.peso || Math.abs(eventi.tramonto.ora - timeToHours(mareaTopSera.tideTime)) < 2) {
            eventoTopSera = { ora: timeToHours(mareaTopSera.tideTime), peso: pesoMarea, tipo: `${mareaTopSera.tide_type === 'HIGH' ? 'Alta' : 'Bassa'} Marea` };
        }
    }

    const formatFinestra = (ora) => {
        const oraInizio = ora - 1;
        const oraFine = ora + 1;
        return `${String(Math.floor(oraInizio)).padStart(2, '0')}:${String(Math.round((oraInizio % 1) * 60)).padStart(2, '0')} - ${String(Math.floor(oraFine)).padStart(2, '0')}:${String(Math.round((oraFine % 1) * 60)).padStart(2, '0')}`;
    };

    return {
        finestraMattino: { orario: formatFinestra(eventoTopMattino.ora) },
        finestraSera: { orario: formatFinestra(eventoTopSera.ora) }
    };
}

module.exports = { calcolaFinestrePesca };