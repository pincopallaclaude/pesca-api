# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

# Imposta la directory di lavoro.
WORKDIR /app

# Non installiamo più Python o ChromaDB qui.

# Copia i file di dipendenza di Node.js.
COPY package*.json ./

# Installa le dipendenze di produzione di Node.js.
RUN npm ci --only=production

# Copia tutto il resto del codice dell'applicazione.
COPY . .

# Esponi la porta che Render si aspetta.
EXPOSE 10000

# Comando di avvio: solo il server Node.js.
CMD ["node", "server.js"]