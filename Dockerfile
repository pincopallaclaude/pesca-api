# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

# Imposta la directory di lavoro.
WORKDIR /app

# Installa Python, pip, curl e ChromaDB.
RUN apt-get update && apt-get install -y python3 python3-pip curl && \
    pip3 install chromadb --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Copia i file di dipendenza di Node.js.
COPY package*.json ./

# Installa le dipendenze di produzione.
RUN npm ci --only=production

# Copia tutto il resto del codice dell'applicazione.
COPY . .

# Rendi eseguibile lo script di avvio.
RUN chmod +x /app/start.sh

# Esponi le porte che verranno usate.
EXPOSE 8080
EXPOSE 8001