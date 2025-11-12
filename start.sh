#!/bin/sh
set -e

echo "--- [STARTUP SCRIPT] Avvio del server ChromaDB in background..."
# Avvia ChromaDB come server, salvando i dati sul disco persistente
chroma run --host 0.0.0.0 --port 8001 --path /data/chroma &

echo "--- [STARTUP SCRIPT] Attesa di 5 secondi per l'avvio di ChromaDB..."
sleep 5

echo "--- [STARTUP SCRIPT] Avvio dell'applicazione Node.js..."
exec node server.js