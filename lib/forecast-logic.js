// /lib/forecast-logic.js
const { myCache } = require('./utils/cache.manager');
const { fetchWwoData } = require('./services/wwo.service');
const { fetchOpenMeteoData } = require('./services/openmeteo.service');
const { fetchStormglassData } = require('./services/stormglass.service');
const { processAndAssemble, combineStormglassData, combineStandardData } = require('./forecast.assembler'); // Importa anche i combiner
const { format } = require('./utils/formatter');

const POSILLIPO_COORDS = '40.813238367880984,14.208944303204635';

async function fetchAndProcessForecast(location) {
    const [lat, lon] = location.split(',');
    const cacheKey = `forecast-data-v1.2-${location}`; // Cache invalidation
    const cachedResult = myCache.get(cacheKey);

    if (cachedResult) {
        console.log(`[Cache] Serving from cache for ${location}.`);
        return cachedResult;
    }

    console.log(`[Cache] Cache miss for ${location}. Triggering fetch.`);
    let unifiedForecastData;
    let fonti;

    if (location === POSILLIPO_COORDS) {
        console.log(`[Core] Location is Posillipo. Attempting Premium fetch...`);
        try {
            const [wwoData, stormglassAggregates, openMeteoData] = await Promise.all([
                fetchWwoData(lat, lon),
                fetchStormglassData(lat, lon),
                fetchOpenMeteoData(lat, lon)
            ]);
            unifiedForecastData = combineStormglassData(stormglassAggregates, wwoData, openMeteoData);
            fonti = "Stormglass.io, Open-Meteo & WWO";
            console.log(`[Core] Premium fetch (Stormglass) successful.`);
        } catch (error) {
            console.warn(`[Core] Premium fetch failed: ${error.message}. Falling back to standard method.`);
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

    const finalForecast = processAndAssemble(unifiedForecastData);

    const dateRange = (finalForecast.length > 0)
        ? `${finalForecast[0].giornoData} - ${finalForecast[finalForecast.length - 1].giornoData}`
        : '';

    const apiResponse = {
        dateRange: dateRange,
        fonti: fonti,
        forecast: finalForecast
    };

    myCache.set(cacheKey, apiResponse);
    console.log(`[Core] Data for ${location} (Source: ${fonti}) cached successfully.`);
    return apiResponse;
}

module.exports = { fetchAndProcessForecast, myCache };