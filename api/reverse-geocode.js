// /api/reverse-geocode.js
import axios from 'axios';

// Esportazione di default di una singola funzione handler
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
        const locationName = response.data.features?.properties?.city || response.data.features?.properties?.address_line1 || 'Posizione Sconosciuta';
        res.status(200).json({ name: locationName });
    } catch (error) {
        console.error("Geoapify Reverse Geocode Error:", error.message);
        res.status(500).json({ message: "An error occurred during reverse geocoding." });
    }
};