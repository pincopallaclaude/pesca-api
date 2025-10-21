// index.js

import 'dotenv/config'; // Carica le variabili d'ambiente all'inizio
import express from 'express';
import cors from 'cors';
import { mcpClient } from './lib/services/mcp-client.service.js';

// Importa le rotte
import forecastRoutes from './api/forecast.routes.js'; // Assumendo che le altre rotte siano qui
import analysisRoutes from './api/analysis.routes.js';
import autocompleteHandler from './api/autocomplete.js';
import reverseGeocodeHandler from './api/reverse-geocode.js';

// Validazione delle variabili d'ambiente critiche
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY non trovato!");
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());

// --- ROUTES ---
// Separiamo le rotte per modularità
app.use('/api', forecastRoutes); // Gestirà /forecast e /update-cache
app.use('/api', analysisRoutes); // Gestirà /get-analysis, /analyze-day-fallback, /get-insight
app.get('/api/autocomplete', autocompleteHandler);
app.get('/api/reverse-geocode', reverseGeocodeHandler);


// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    mcp: mcpClient.connected ? 'connected' : 'disconnected',
    timestamp: new Date().toISOString() 
  });
});

app.get('/', (req, res) => res.status(200).send('Pesca API Server v7.0 (MCP-Enabled) is running!'));

// Avvio del server
async function startServer() {
  try {
    // Connetti il client MCP al server embedded
    await mcpClient.connect();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
      console.log(`🎣 MCP-Enhanced RAG System is active.`);
    });

  } catch (error) {
    console.error('❌ Fallimento avvio server:', error);
    process.exit(1);
  }
}

// Gestione dello shutdown pulito
process.on('SIGTERM', async () => {
  console.log('📴 SIGTERM ricevuto, avvio shutdown...');
  await mcpClient.disconnect();
  process.exit(0);
});

startServer();