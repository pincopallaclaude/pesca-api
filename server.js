const express = require('express');
const path = require('path');
const cors = require('cors');
const { fetchAndProcessForecast } = require('./lib/forecast-logic.js');

// <-- 1. Importiamo i gestori delle nuove rotte
const autocompleteHandler = require('./api/autocomplete.js'); 
const reverseGeocodeHandler = require('./api/reverse-geocode.js');

const app = express();
const PORT = process.env.PORT || 3001;

// --- MIDDLEWARE ---
app.use(cors());
app.use(express.json());

// --- ROUTES API ---
const apiRouter = express.Router();

// /api/forecast
apiRouter.get('/forecast', async (req, res) => {
    try {
        const location = req.query.location;
        if (!location) {
            return res.status(400).json({ message: 'Location parameter is required' });
        }
        const data = await fetchAndProcessForecast(location);
        return res.status(200).json(data);
    } catch (error) {
        console.error("API Error in /forecast:", error.message);
        return res.status(500).json({ message: "An error occurred" });
    }
});

// <-- 2. Aggiungiamo la rotta per l'autocomplete
apiRouter.get('/autocomplete', autocompleteHandler);

// <-- 3. Aggiungiamo la rotta per il reverse-geocode
apiRouter.get('/reverse-geocode', reverseGeocodeHandler);


// /api/update-cache (la tua logica esistente)
apiRouter.get('/update-cache', async (req, res) => {
   // ... (La sua logica per update-cache qui, è corretta)
   res.status(200).send('Cache update logic would run here.');
});

// Utilizziamo le route sotto il prefisso /api
app.use('/api', apiRouter);

// --- ROUTE DI CONTROLLO "SONO VIVO?" ---
app.get('/', (req, res) => {
  res.status(200).send('Pesca API Server is running!');
});


// --- AVVIO DEL SERVER ---
app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});