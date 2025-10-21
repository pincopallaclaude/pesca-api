# Usa una versione di Node.js LTS (Long Term Support) come base
ARG NODE_VERSION=20
FROM node:${NODE_VERSION}-slim AS base

LABEL fly_launch_runtime="Node.js"

# Imposta la directory di lavoro all'interno del container
WORKDIR /app

# Imposta l'ambiente di produzione
ENV NODE_ENV="production"

# Usa una build stage per installare le dipendenze
FROM base AS build
WORKDIR /app

# Copia solo i file di definizione delle dipendenze per sfruttare la cache di Docker
COPY package.json package-lock.json ./

# Installa solo le dipendenze di produzione
RUN npm ci --omit=dev

# Copia il resto del codice dell'applicazione
COPY . .

# --- Final Image ---
FROM base
WORKDIR /app

# Copia le dipendenze installate e il codice dalla build stage
COPY --from=build /app /app

# La porta esposta deve corrispondere a quella su cui il server è in ascolto
EXPOSE 8080

# Comando per avviare l'applicazione
CMD [ "npm", "run", "start" ]