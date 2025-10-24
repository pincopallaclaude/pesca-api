// /api/reverse-geocode.js

import axios from 'axios';

// L'esportazione di default (export default) è il modo corretto per esportare
// una singola funzione anonima o una funzione del gestore API in ES Modules.
export default async (req, res) => {
    const { lat, lon } = req.query;
    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

    if (!GEOAPIFY_API_KEY) {
        return res.status(500).json({ message: "Geoapify API key not configured." });
    }

    if (!lat || !lon) {
        return res.status(400).json({ message: "Latitude and longitude are required." });
    }

    const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}`;

    try {
        const response = await axios.get(url);
        // Estraiamo il nome della città o il dato più rilevante disponibile
        const locationName = response.data.features[0].properties.city || response.data.features[0].properties.address_line1 || 'Posizione Attuale';

        res.status(200).json({ name: locationName });

    } catch (error) {
        console.error("Geoapify Reverse Geocode Error:", error.message);
        res.status(500).json({ message: "An error occurred during reverse geocoding." });
    }
};