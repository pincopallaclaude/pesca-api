// /lib/services/geo.service.js

import axios from 'axios';

/**
 * Converte un nome di località (es. "Napoli") in coordinate geografiche (lat, lon).
 * @param {string} locationName Il nome della località.
 * @returns {Promise<{lat: number, lon: number, name: string}|null>}
 */
export async function geocodeLocation(locationName) {
    const apiKey = process.env.GEOAPIFY_API_KEY;
    if (!apiKey) {
        console.error('[GeoService] GEOAPIFY_API_KEY non è impostata.');
        return null;
    }

    const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(locationName)}&apiKey=${apiKey}&limit=1`;

    try {
        const response = await axios.get(url);
        const features = response.data.features;

        if (features && features.length > 0) {
            const { lat, lon } = features[0].properties;
            const name = features[0].properties.city || features[0].properties.name || locationName;
            return { lat, lon, name };
        }
        return null;
    } catch (error) {
        console.error(`[GeoService] Errore durante il geocoding per "${locationName}":`, error.message);
        return null;
    }
}