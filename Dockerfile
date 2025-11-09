# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

WORKDIR /app


# Installa Python e poi usa PIP per installare versioni SPECIFICHE e COMPATIBILI dei pacchetti
RUN apt-get update && apt-get install -y python3 python3-pip curl wget && \
    pip3 install "numpy<2.0" "chromadb==0.5.0" "uvicorn[standard]" "pydantic-settings" "opentelemetry-instrumentation-fastapi" --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Copia e installa le dipendenze Node.js (con la libreria 'next')
COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 10000

# Il comando di avvio rimane lo stesso, ma ora eseguirà il server ChromaDB v0.5.0
CMD ["/bin/sh", "-c", "uvicorn chromadb.app:app --host 127.0.0.1 --port 8001 --anonymized-telemetry=False & sleep 15 && exec node server.js"]