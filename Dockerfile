# Usa un'immagine ufficiale di Node.js.
FROM node:20-slim

WORKDIR /app

# --- MODIFICA CHIAVE: Imposta la variabile d'ambiente per disabilitare la telemetria ---
ENV ANONYMIZED_TELEMETRY=False

RUN apt-get update && apt-get install -y python3 python3-pip curl wget && \
    pip3 install "numpy<2.0" "chromadb==0.5.0" "uvicorn[standard]" "pydantic-settings" "opentelemetry-instrumentation-fastapi" --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

# Copia e installa le dipendenze Node.js
COPY package.json package-lock.json ./
RUN npm ci --only=production

COPY . .

# Crea le directory necessarie per i dati persistenti
# Questo assicura che esistano anche se il disco è vuoto alla prima esecuzione
RUN mkdir -p /data/memory /data/chroma /data/ml

EXPOSE 10000

# Rendi lo script di avvio eseguibile e impostalo come comando di default
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]