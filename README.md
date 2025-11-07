# pesca-api











<!-- SCRIPT:START -->
## Architettura e Contesto Backend (Auto-generato)

Questa sezione fornisce una panoramica dell'architettura del backend Node.js, come descritto nel documento di contesto del progetto.

----------------------------------------------------------------------
3. ORGANIZZAZIONE DEI MICROSERVIZI (BACKEND)
----------------------------------------------------------------------

L'architettura backend (pesca-api) è un'applicazione Node.js (Express.js) con i seguenti endpoint:
* /api/forecast: Restituisce le previsioni complete.
* /api/update-cache: Per l'aggiornamento proattivo della cache via Cron Job.
* /api/autocomplete: Per i suggerimenti di località.
* /api/reverse-geocode: Per la geolocalizzazione inversa.


----------------------------------------------------------------------
4. GESTIONE DELLA CACHE
----------------------------------------------------------------------

Strategia di caching a due livelli:

    4.1 Cache Backend (lato Server)
        * Gestita con 
ode-cache`, ha un TTL di 6 ore.
        * Aggiornamento proattivo per Posillipo via Cron Job.

    4.2 Cache Frontend (lato Client)
        * L'app Flutter usa shared_preferences con un TTL di 6 ore.
        * Garantisce caricamenti istantanei e fallback su dati obsoleti in caso di errore di rete.
        * Le chiavi sono versionate per una facile invalidazione.


----------------------------------------------------------------------
5. API METEO UTILIZZATE
----------------------------------------------------------------------

Architettura ibrida e ottimizzata:
* Dati Giornalieri di Base (Tutte le località): WorldWeatherOnline (astronomia, maree).
* Dati Orari ad Alta Risoluzione (Tutte le località): Open-Meteo (temperatura, vento, onde, ecc.).
* Dati Premium (Solo Posillipo): Si tenta di usare Stormglass.io per sovrascrivere i dati marini standard con valori più precisi. In caso di fallimento, il sistema procede con i dati standard.


----------------------------------------------------------------------
6. STACK TECNOLOGICO E DEPLOYMENT
----------------------------------------------------------------------

* Backend (pesca-api): Node.js con Express.js.
* Frontend (pesca_app): Flutter con linguaggio Dart.
    * Package Principali: geolocator, shared_preferences,  app_settings, weather_icons, 'fl_chart.
* Version Control: Entrambi i progetti sono su GitHub.
* Hosting & Deployment: Backend su Render.com con deploy automatico.


----------------------------------------------------------------------
7. STRUTTURA DEL PROGETTO AD ALTO LIVELLO
----------------------------------------------------------------------

* Backend (pesca-api):
    * Il codice è stato refattorizzato in una struttura modulare e manutenibile che separa le responsabilità in diverse cartelle e file (services/, domain/, utils/, 'forecast.assembler.js).

* Frontend (pesca_app):
    * Il codice è stato refattorizzato in una struttura modulare e scalabile, con una netta separazione tra models/, screens/, widgets/, services/ e utils/.

### Struttura del Progetto Backend

La seguente è una rappresentazione commentata della struttura attuale del progetto, arricchita con la conoscenza architetturale:

```
|-- api/ # Contiene i file che definiscono le route e la logica API.
|   |-- autocomplete.js # Modulo che esporta funzionalità o dati.
|   |-- reverse-geocode.js # Modulo che esporta funzionalità o dati.
|-- lib/ # Contiene tutta la logica di business e i moduli core dell'applicazione.
|   |-- domain/ # Contiene la logica di business pura, slegata da API e dettagli implementativi.
|   |   |-- score.calculator.js # Modulo dedicato al calcolo del pescaScore. Contiene la funzione che, dati i parametri meteo di una singola ora, calcola il punteggio numerico e le ragioni testuali.
|   |   |-- window.calculator.js # Modulo responsabile del calcolo delle finestre di pesca ottimali. Contiene la funzione che, data una serie di punteggi orari, identifica e formatta le migliori fasce orarie (es. '07:00 - 09:00').
|   |-- services/ # Contiene i moduli responsabili della comunicazione con le API esterne. Ogni file è uno 'specialista'.
|   |   |-- openmeteo.service.js # Gestisce le chiamate agli endpoint di Open-Meteo per recuperare i dati orari ad alta risoluzione (temperatura, vento, onde, etc.).
|   |   |-- stormglass.service.js # Gestisce la chiamata all'API premium di Stormglass.io per ottenere dati marini di alta precisione (usato solo per località specifiche come Posillipo).
|   |   |-- wwo.service.js # Gestisce la chiamata all'API di WorldWeatherOnline per recuperare i dati giornalieri di base, come astronomia (alba/tramonto) e maree.
|   |-- utils/ # Contiene funzioni di utilità pure, generiche e riutilizzabili in tutto il progetto.
|   |   |-- cache.manager.js # Centralizza la configurazione e l'esportazione dell'istanza di node-cache, gestendo il Time-To-Live (TTL) di default.
|   |   |-- formatter.js # Contiene tutte le funzioni di formattazione dei dati per la UI, come la conversione degli orari, la capitalizzazione delle stringhe e la determinazione dell'acronimo per lo stato del mare.
|   |   |-- wmo_code_converter.js # Modulo specializzato nel 'tradurre' i codici meteo numerici (standard WMO di Open-Meteo) nelle icone emoji e nelle direzioni del vento testuali (es. 'NNE') attese dal client.
|   |-- forecast-logic.js # Il 'direttore d'orchestra' e punto d'ingresso principale per la logica di forecast. Gestisce la cache, decide quale fonte dati usare (Standard vs Premium), chiama l'assemblatore per unificare i dati, e infine invoca la logica di dominio per arricchire l'output con il pescaScore e le finestre di pesca, producendo il JSON finale per l'app.
|   |-- forecast.assembler.js # Il 'maestro assemblatore'. Non contiene logica di business, ma orchestra i dati. Prende i dati grezzi e trasformati dai vari servizi e li combina nella struttura dati intermedia e unificata (unifiedForecastData).
|-- public/ # Contiene file statici serviti al client.
|   |-- fish_icon.png # File di tipo '.png'.
|   |-- half_moon.png # File di tipo '.png'.
|   |-- index.html # File HTML.
|   |-- logo192.png # File di tipo '.png'.
|   |-- logo512.png # File di tipo '.png'.
|   |-- manifest.json # File di dati/configurazione JSON.
|-- .env # Contiene le variabili d'ambiente (dati sensibili).
|-- package-lock.json # Registra la versione esatta di ogni dipendenza.
|-- package.json # File manifesto del progetto: dipendenze, script, etc.
|-- README.md # File di documentazione Markdown.
|-- server.js # Punto di ingresso principale dell'applicazione. Avvia il server Express e imposta le route.
```

<!-- SCRIPT:END -->















