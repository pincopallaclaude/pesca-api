# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

WORKDIR /app

# --- MODIFICA CHIAVE ---
# Installa Python e poi usa PIP per installare una versione RECENTE e specifica di ChromaDB
RUN apt-get update && apt-get install -y python3 python3-pip curl wget && \
    pip3 install "chromadb==0.5.0" "uvicorn[standard]" "pydantic-settings" "opentelemetry-instrumentation-fastapi" --break-system-packages && \
    rm -rf /var/lib/apt/lists/*
# --- FINE MODIFICA ---

# Copia e installa le dipendenze Node.js (con la libreria 'next')
COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 10000

# Il comando di avvio rimane lo stesso, ma ora eseguirà il server ChromaDB v0.5.0
CMD ["/bin/sh", "-c", "uvicorn chromadb.app:app --host 127.0.0.1 --port 8001 & sleep 15 && exec node server.js"]