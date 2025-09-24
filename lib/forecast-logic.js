// /lib/forecast-logic.js
const { myCache } = require('./utils/cache.manager');
const { fetchWwoData } = require('./services/wwo.service');
const { fetchOpenMeteoData } = require('./services/openmeteo.service');
const { fetchStormglassData } = require('./services/stormglass.service');
const { combineStandardData, combineStormglassData, assembleFinalForecast } = require('./forecast.assembler');
const { format, parseISO } = require('./utils/formatter');

const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

async function fetchAndProcessForecast(location) {
    const [lat, lon] = location.split(',');
    const cacheKey = `forecast-data-v1.0-${location}`; // Cache key aggiornata
    const cachedResult = myCache.get(cacheKey);

    if (cachedResult) {
        console.log(`[Cache] Serving from cache for ${location}.`);
        return cachedResult;
    }

    console.log(`[Cache] Cache miss for ${location}. Triggering fetch.`);
    let unifiedForecastData;
    let fonti;

    if (location === POSILLIPO_COORDS) {
        console.log(`[Core] Location is Posillipo. Attempting fetch with Stormglass...`);
        try {
            const [wwoData, stormglassAggregates] = await Promise.all([
                fetchWwoData(lat, lon),
                fetchStormglassData(lat, lon)
            ]);
            unifiedForecastData = combineStormglassData(stormglassAggregates, wwoData);
            fonti = "Stormglass.io & WorldWeatherOnline.com";
            console.log(`[Core] Stormglass fetch and process successful.`);
        } catch (error) {
            console.warn(`[Core] Stormglass failed: ${error.message}. Falling back to standard method.`);
            const [wwoData, openMeteoData] = await Promise.all([
                fetchWwoData(lat, lon),
                fetchOpenMeteoData(lat, lon)
            ]);
            unifiedForecastData = combineStandardData(wwoData, openMeteoData);
            fonti = "WorldWeatherOnline.com & Open-Meteo.com";
        }
    } else {
        const [wwoData, openMeteoData] = await Promise.all([
            fetchWwoData(lat, lon),
            fetchOpenMeteoData(lat, lon)
        ]);
        unifiedForecastData = combineStandardData(wwoData, openMeteoData);
        fonti = "WorldWeatherOnline.com & Open-Meteo.com";
    }

    const finalForecast = assembleFinalForecast(unifiedForecastData);

    const apiResponse = {
        dateRange: `${format(parseISO(finalForecast[0].giornoData.split('/').reverse().join('-')), 'dd/MM')} - ${format(parseISO(finalForecast[finalForecast.length - 1].giornoData.split('/').reverse().join('-')), 'dd/MM')}`,
        fonti: fonti,
        forecast: finalForecast
    };

    myCache.set(cacheKey, apiResponse);
    console.log(`[Core] Data for ${location} (Source: ${fonti}) cached successfully.`);
    return apiResponse;
}

module.exports = { fetchAndProcessForecast, myCache }; // Esporta solo ciò che serve al server.js