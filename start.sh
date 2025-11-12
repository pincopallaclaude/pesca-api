#!/bin/sh
set -e

echo "--- [STARTUP SCRIPT] Avvio del server ChromaDB in background..."
chroma run --host 0.0.0.0 --port 8001 --path /data/chroma &

echo "--- [STARTUP SCRIPT] Attesa di 15 secondi per l'avvio di ChromaDB..."
sleep 15

echo "--- [STARTUP SCRIPT] Avvio dell'applicazione Node.js..."

exec node server.js