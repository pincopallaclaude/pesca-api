// /lib/services/stormglass.service.js

import axios from 'axios';
// [REFACTOR] Import the necessary utility directly.
import { degreesTo16PointDirection } from '../utils/wmo_code_converter.js';


/**
 * Fetches and processes marine current data from Stormglass API.
 * This service is called only for premium locations (e.g., Posillipo).
 *
 * @param {number|string} lat - Latitude.
 * @param {number|string} lon - Longitude.
 * @returns {Promise<object|null>} - An object with dates as keys and arrays of hourly data as values, or null on failure.
 */
async function fetchStormglassData(lat, lon) {
    const apiKey = process.env.STORMGLASS_API_KEY;
    if (!apiKey) {
        throw new Error("STORMGLASS_API_KEY is not defined in environment variables.");
    }
    
    // Request only current speed and direction
    const params = 'currentSpeed,currentDirection';
    const url = `https://api.stormglass.io/v2/weather/point`;

    console.log('[Stormglass Service] Fetching data...');
    
    // Retry logic with exponential backoff (best practice)
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await axios.get(url, {
                params: { lat, lng: lon, params },
                headers: { 'Authorization': apiKey }
            });

            if (!response.data || !response.data.hours) {
                throw new Error("Invalid response structure from Stormglass API.");
            }

            const dataByDay = {};

            for (const hourData of response.data.hours) {
                const isoDate = hourData.time;
                const date = isoDate.split('T')[0];
                const hour = isoDate.split('T')[1].substring(0, 2);

                if (!dataByDay[date]) {
                    dataByDay[date] = [];
                }

                let speedInKnots = 'N/D';
                let directionStr = 'N/D';

                // Safely access currentSpeed, which is in meters per second (m/s)
                if (hourData.currentSpeed?.sg != null) {
                    const speedMs = hourData.currentSpeed.sg;
                    // Convert m/s to knots (1 m/s = 1.94384 knots)
                    let kn = speedMs * 1.94384;
                    if (kn > 0 && kn < 0.1) kn = 0.1; // Floor for very small values
                    speedInKnots = kn.toFixed(1); // Use 1 decimal place for consistency
                }
                
                // Safely access currentDirection
                if (hourData.currentDirection?.sg != null) {
                    directionStr = degreesTo16PointDirection(hourData.currentDirection.sg);
                }

                dataByDay[date].push({
                    hour: hour,
                    // [FIX] Corrected variable name from 'speedInKnots' to 'speedInKnots' (was a typo)
                    currentSpeedKn: speedInKnots,
                    currentDirectionStr: directionStr,
                });
            }

            console.log(`[Stormglass Service] Data processed for ${Object.keys(dataByDay).length} days.`);
            return dataByDay;

        } catch (error) {
            console.warn(`[Stormglass Service] Attempt ${attempt} failed. Error: ${error.message}`);
            if (attempt < 3) {
                const delay = Math.pow(2, attempt) * 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // On final failure, re-throw a clearer error to the caller
                throw new Error(`Stormglass fetch failed after 3 attempts: ${error.message}`); 
            }
        }
    }
    return null; // Should not be reached, but as a fallbackk
}

export { fetchStormglassData };