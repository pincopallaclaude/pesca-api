// /api/autocomplete.js

import axios from 'axios';

export default async (req, res) => {
    // Leggiamo il testo da cercare dalla query string (?text=...)
    const { text } = req.query;
    
    // Leggiamo la chiave API segreta dalle variabili d'ambiente di Vercel
    const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

    if (!GEOAPIFY_API_KEY) {
        return res.status(500).json({ message: "Geoapify API key not configured." });
    }

    if (!text || text.length < 3) {
        // Non avviare la ricerca per meno di 3 caratteri
        return res.status(200).json([]);
    }

    const url = `https://api.geoapify.com/v1/geocode/autocomplete?text=${encodeURIComponent(text)}&type=city&format=json&limit=5&apiKey=${GEOAPIFY_API_KEY}`;

    try {
        const response = await axios.get(url);

        // Formattiamo la risposta in un modo semplice per il frontend
        const suggestions = response.data.results.map(item => ({
            name: item.formatted,
            lat: item.lat,
            lon: item.lon,
        }));

        res.status(200).json(suggestions);

    } catch (error) {
        console.error("Geoapify API Error:", error.message);
        res.status(500).json({ message: "An error occurred while fetching autocomplete data." });
    }
};