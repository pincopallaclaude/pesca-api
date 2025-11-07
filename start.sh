#!/bin/sh
set -e

# Avvia ChromaDB in background
/usr/local/bin/chroma run --host 0.0.0.0 --port 8001 --path /data/chroma &

# Attendi qualche secondo per sicurezza
sleep 5

# Avvia Node.js in foreground
exec node server.js