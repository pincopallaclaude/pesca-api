#!/bin/sh
set -e

echo "--- [STARTUP SCRIPT] Avvio del container..."

# Verifica e crea le directory se non esistono (doppio controllo per robustezza)
echo "--- [STARTUP SCRIPT] Verifica delle directory dati..."
mkdir -p /data/memory
mkdir -p /data/chroma
mkdir -p /data/ml
echo "--- [STARTUP SCRIPT] Directory verificate."

# Non è più necessario avviare ChromaDB come server separato.
# La nostra libreria `chromadb` in Node.js lo gestirà in-process,
# scrivendo i file direttamente nel percorso /data/chroma.

echo "--- [STARTUP SCRIPT] Avvio dell'applicazione Node.js..."
# Avvia Node.js in foreground, che ora gestisce tutto.
exec node server.js