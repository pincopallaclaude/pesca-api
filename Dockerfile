# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

# Imposta la directory di lavoro.
WORKDIR /app

# Installa Python, pip e le dipendenze di sistema necessarie per ChromaDB
RUN apt-get update && apt-get install -y python3 python3-pip curl wget && \
    pip3 install chromadb uvicorn fastapi[all] pydantic-settings --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Copia i file di dipendenza di Node.js.
COPY package*.json ./

# Installa le dipendenze di produzione di Node.js.
RUN npm ci --only=production

# Copia tutto il resto del codice dell'applicazione.
COPY . .

# Esponi la porta del server Node.js che Render userà.
EXPOSE 8080

# Comando di avvio che orchestra i due processi.
# Usa la stessa logica di 'sleep' per sfasare l'avvio e risparmiare RAM.
CMD ["/bin/sh", "-c", "uvicorn chromadb.app:app --host 127.0.0.1 --port 8001 & sleep 15 && exec node server.js"]