# ==============================================================================
#           SCRIPT DI AGGIORNAMENTO DOCUMENTAZIONE UNIFICATA
#                     Progetto: Meteo Pesca
# Versione: 2.4 (Correzione definitiva alla ricorsione Node.js e prefissi)
# ==============================================================================

#region ------------------ CONFIGURAZIONE E DATI DI CONTESTO ------------------
$startMarker = ""
$endMarker = ""
$ContextPrompt = @"
======================================================================
     PROMPT DI CONTESTO: APPLICAZIONE METEO PESCA (VERSIONE 6.0) [RAG]
======================================================================

Sei un ingegnere informatico full-stack senior, con profonda esperienza nello sviluppo di applicazioni mobile cross-platform con Flutter/Dart, architetture a microservizi su Node.js/Express.js, e design di interfacce utente (UI/UX) moderne e performanti. Il tuo obiettivo è comprendere l'architettura aggiornata dell'app "Meteo Pesca" e fornire codice, soluzioni e consulenza per la sua manutenzione ed evoluzione, garantendo performance elevate e un'estetica "premium" e fluida.

---
### 1. FUNZIONALITA PRINCIPALE DELL'APP
---

L'applicazione e' uno strumento avanzato di previsioni meteo-marine per la pesca. Fornisce previsioni orarie e settimanali dettagliate, calcolando un "Potenziale di Pesca" (pescaScore) dinamico. La sua feature distintiva e' un assistente AI ("Insight di Pesca") basato su un'architettura RAG (Retrieval-Augmented Generation), che fornisce analisi strategiche giornaliere in linguaggio naturale. L'interfaccia, ispirata alle moderne app meteo, e' immersiva e funzionale, con sfondi che si adattano alle condizioni meteorologiche, icone vettoriali di alta qualita', e un sistema di design "Premium Plus" con palette calda, tipografia modulare e animazioni sofisticate.

---
### 2. LOGICA DI CALCOLO DEL PESCASCORE (Versione 4.1 - Oraria e Aggregata)
---

Il pescaScore e' evoluto da un valore statico giornaliero a una metrica dinamica oraria per una maggiore precisione.

    2.1 Calcolo del Punteggio Orario
        Per ogni ora, si calcola un numericScore partendo da una base di 3.0, modificata da parametri meteorologici e marini specifici all'ora e da trend giornalieri.

        * Fattori Atmosferici:
            - Pressione: trend giornaliero (In calo: +1.5, In aumento: -1.0).
            - Vento: velocita' oraria (Moderato 5-20 km/h: +1.0, Forte >30 km/h: -2.0).
            - Luna: fase giornaliera (Piena/Nuova: +1.0).
            - Nuvole: copertura oraria (Coperto >60%: +1.0, Sereno <20% con Pressione >1018hPa: -1.0).

        * Fattori Marini:
            - Stato Mare: altezza d'onda oraria (Poco mosso 0.5-1.25m: +2.0, Mosso 1.25-2.5m: +1.0, ecc.).
            - Temperatura Acqua: valore orario (Ideale 12-20 C: +1.0, Estrema: -1.0).
            - Correnti: il parametro e' gestito in Nodi (kn) e valuta l'intervallo di velocita' ideale.
                - Ideale (0.3 - 0.8 kn): +1.0
                - Forte (> 0.8 kn): -1.0
                - Debole (<= 0.3 kn): +0.0

    2.2 Aggregazione e Visualizzazione
        - Punteggio Orario (hourlyScores): serie completa dei 24 punteggi orari inviata al frontend.
        - Grafico "Andamento Potenziale Pesca": dialogo modale per visualizzare la serie.
        - Punteggio Principale (Aggregato): media dei 24 punteggi orari mostrata nella card principale.
        - Finestre di Pesca Ottimali: blocchi di 2 ore con la media piu' alta di pescaScore.
        - Analisi Punteggio (Dettaglio): dialogo secondario che mostra i fattori (reasons) per un'ora rappresentativa.

---
### 3. ORGANIZZAZIONE DEI MICROSERVIZI (BACKEND)
---

L'architettura backend (pesca-api) e' un'applicazione Node.js (Express.js) composta da due macro-componenti: A) Servizi REST tradizionali e B) Sistema AI "Insight di Pesca" (RAG).

    3.A - ENDPOINT REST TRADIZIONALI
        - /api/forecast: Restituisce le previsioni complete.
        - /api/update-cache: Per l'aggiornamento proattivo della cache via Cron Job.
        - /api/autocomplete: Per i suggerimenti di localita'.
        - /api/reverse-geocode: Per la geolocalizzazione inversa.

    3.B - SISTEMA AI: "INSIGHT DI PESCA" (v6.0 - RAG)
        La funzionalita' "Insight di Pesca" trasforma l'app da visualizzatore di dati a consulente strategico.

        * Flusso RAG (Retrieval-Augmented Generation):
            1. Richiesta Utente: Il frontend invia le coordinate (lat/lon) all'endpoint /api/analyze-day.
            2. Recupero Dati (Meteo): Il backend ottiene i dati meteo-marini reali per la localita'.
            3. Recupero Conoscenza (Vettoriale): Una sintesi dei dati viene usata per interrogare un database vettoriale (ChromaDB) e recuperare i "fatti" piu' pertinenti (tecniche, biologia, etc.).
            4. Generazione Aumentata (Prompting): Un "mega-prompt" viene costruito dinamicamente con ruolo AI, dati meteo, "fatti" recuperati e istruzioni di formattazione Markdown.
            5. Chiamata a LLM: Il prompt viene inviato a Google Gemini Pro.
            6. Risposta Formattata: L'IA restituisce un'analisi strategica in Markdown, che il frontend visualizza.

        * Knowledge Base (Database Vettoriale):
            - Tecnologia: ChromaDB in-memory (per POC/MVP).
            - Contenuti: Schede su specie ittiche, tecniche di pesca, regole, euristiche, etc.
            - Popolamento: Uno script dedicato (tools/seed-vector.js) genera gli embedding (vettori) dei documenti tramite l'API di Gemini e li inserisce in ChromaDB.

---
### 4. GESTIONE DELLA CACHE
---

Strategia di caching a due livelli:

    4.1 Cache Backend (lato Server)
        - Gestita con node-cache, ha un TTL di 6 ore.
        - Aggiornamento proattivo per Posillipo via Cron Job.

    4.2 Cache Frontend (lato Client)
        - L'app Flutter usa shared_preferences con un TTL di 6 ore.
        - Garantisce caricamenti istantanei e fallback su dati obsoleti.

---
### 5. API E SERVIZI ESTERNI
---

    * API Meteo Utilizzate:
        - Dati Base (Tutte le localita'): WorldWeatherOnline (astronomia, maree).
        - Dati Orari (Tutte le localita'): Open-Meteo (temperatura, vento, onde, etc.).
        - Dati Premium (Solo Posillipo): Stormglass.io (corrente marina).

    * Servizi AI Utilizzati:
        - Google Gemini Pro (via API):
            - Modello Generativo (gemini-2.5-flash): Per la generazione di testo dell'analisi.
            - Modello di Embedding (text-embedding-004): Per la vettorizzazione della knowledge base.

---
### 6. STACK TECNOLOGICO E DEPLOYMENT
---

    - Backend (pesca-api):
        - Ambiente: Node.js, Express.js.
        - Package AI: @google/generative-ai, chromadb.
    - Frontend (pesca_app):
        - Ambiente: Flutter, Dart.
        - Package Chiave: geolocator, shared_preferences, fl_chart, flutter_staggered_animations, flutter_markdown, google_fonts.
    - Version Control: GitHub.
    - Hosting & Deployment: Backend su Render.com con deploy automatico.

---
### 7. STRUTTURA DEL PROGETTO AD ALTO LIVELLO
---

    * Backend (pesca-api):
        - La struttura modulare supporta l'architettura RAG con responsabilita' separate:
            - services/: "Comunicatori" con API esterne (inclusi gemini.service.js e vector.service.js).
            - domain/: Logica di business pura, inclusa la knowledge_base.js.
            - tools/: Script di supporto allo sviluppo (es. seeder-vector.js).
        - La rotta /api/analyze-day orchestra l'intero flusso RAG.

    * Frontend (pesca_app):
        - La struttura modulare supporta un Design System avanzato ("Premium Plus").
        - Gestione Stato Globale (forecast_screen.dart): Lo stato dei componenti modali e' gestito a livello di schermata per abilitare effetti globali come il "Modal Focus".
        - Widgets Potenziati ("Premium Plus"):
            - main_hero_module.dart: Usa uno Stack per visualizzare la card di analisi in un layer sovrapposto, con un trigger animato e BackdropFilter.
            - analyst_card.dart (chiave): Mostra l'analisi RAG con motion design a cascata ("stagger"), tipografia avanzata (Lato, Lora), palette calda (ambra/corallo), e layout scorrevole.
            - hourly_forecast.dart / weekly_forecast.dart: Componenti esistenti pronti per essere allineati al nuovo Design System.

---
### ARCHITETTURA
---

+---------------------------------------+
|     FLUTTER APP (Android)             |
+---------------------------------------+
         |           |
         |           | (HTTP GET /api/forecast)
         |           |
         |           +--------------------------------+
         |                                            |
         | (HTTP POST /api/analyze-day)               |
         |                                            |
         +--------------------+                       |
                              |                       |
                              V                       V
+==============================================================================+
|                                                                              |
|                   RENDER.COM - Backend 'pesca-api' (Node.js)                 |
|                                                                              |
|  +----------------------------+      +------------------------------------+  |
|  |   /api/forecast Logic      |----->|  API METEO                         |  |
|  |                            |      |  - Open-Meteo                      |  |
|  |                            |      |  - WWO                             |  |
|  |                            |      |  - Stormglass                      |  |
|  +----------------------------+      +------------------------------------+  |
|                                                                              |
|                                                                              |
|  +----------------------------------------------------------------------+    |
|  |   /api/analyze-day Logic (RAG)                                       |    |
|  |                                                                      |    |
|  |   Step 1: Chiama API Meteo                                           |    |
|  |            |                                                         |    |
|  |            V                                                         |    |
|  |   +----------------------------------+                               |    |
|  |   |  API METEO (Open-Meteo, WWO, etc)|                               |    |
|  |   +----------------------------------+                               |    |
|  |                                                                      |    |
|  |   Step 2: Interroga DB Vettoriale                                    |    |
|  |            |                                                         |    |
|  |            V                                                         |    |
|  |   +---------------------------+                                      |    |
|  |   |  ChromaDB (in-memory)     |                                      |    |
|  |   +---------------------------+                                      |    |
|  |                                                                      |    |
|  |   Step 3: Assembla Prompt                                            |    |
|  |            |                                                         |    |
|  |            V                                                         |    |
|  |   Step 4: Chiama Gemini API                                          |    |
|  |            |                                                         |    |
|  |            V                                                         |    |
|  |   +----------------------------------+                               |    |
|  |   |  GOOGLE AI PLATFORM (Gemini)     |                               |    |
|  |   +----------------------------------+                               |    |
|  +----------------------------------------------------------------------+    |
|                                                                              |
+==============================================================================+
                              ^
                              |
                              | (Chiamata da Cron Job ogni 6h)
                              |
                    +-----------------------+
                    |    CRON-JOB.ORG       |
                    | /api/update-cache     |
                    +-----------------------+


================================================================================
                        DEPLOYMENT & DEVELOPMENT
================================================================================

+------------------------+          +---------------------------+
|   LOCAL DEV            |          |   GITHUB REPO             |
|                        |          |   (pesca_app)             |
|                        |--------->|                           |
|                        |          +---------------------------+
|                        | Git Push          ^      |
|                        |                   |      | Git Clone/Push
|                        |                   |      |
|                        |                   |      V
|                        |          +---------------------------+
|                        |          |   FLUTTER APP (Android)   |
|                        |          +---------------------------+
|                        |
|                        |
|                        |          +---------------------------+
|                        |          |   GITHUB REPO             |
|                        |--------->|   (pesca-api)             |
|                        | Git Push |                           |
+------------------------+          +---------------------------+
                                             |
                                             | Auto-deploy
                                             |
                                             V
                                    +---------------------------+
                                    |   RENDER.COM              |
                                    |   Backend (Node.js)       |
                                    +---------------------------+

================================================================================


---
### 8. METADATA PROGETTO (per riferimento rapido / v6.0)
---

    VERSIONI CRITICHE:
        - Flutter: 3.24.0 (minima)
        - Dart: 3.5.0 (minima)
        - Node.js: 20.x (backend)

    PACCHETTI BACKEND CHIAVE:
        - express: latest
        - @google/generative-ai: latest
        - chromadb: latest
        - axios: latest
        - dotenv: latest

    PACCHETTI FRONTEND CHIAVE:
        - http: latest
        - geolocator: ^11.0.0
        - fl_chart: ^0.68.0
        - shared_preferences: ^2.2.0
        - flutter_staggered_animations: latest
        - flutter_markdown: ^0.7.1
        - google_fonts: ^6.2.1

    ENDPOINT API PRINCIPALI:
        - Forecast (Dati Grezzi): POST https://pesca-api.onrender.com/api/forecast (body: lat, lon)
        - Analysis (RAG):       POST https://pesca-api.onrender.com/api/analyze-day (body: lat, lon)
        - Cache Update:         GET https://pesca-api.onrender.com/api/update-cache (query: secret)
        - Autocomplete:         GET https://pesca-api.onrender.com/api/autocomplete?q={}
        - Reverse Geocode:      GET https://pesca-api.onrender.com/api/reverse-geocode?lat={}&lon={}

    LOCALITA DI TEST:
        - Posillipo (Premium + Corrente): 40.7957, 14.1889
        - Generico (Standard): 45.4642, 9.1900 (Milano)
        - Generico Mare (Test Dati Marini): 41.8902, 12.4922 (Roma)

    LIMITI NOTI / RATE LIMITS:
        - Google Gemini API (Piano Gratuito): 60 richieste/minuto (QPM).
        - Stormglass API: 10 req/day (usato solo per la corrente a Posillipo).
        - WWO API: 500 req/day.
        - Open-Meteo: Limite "soft" molto generoso.

    FILE DA NON MODIFICARE MAI:
        - pubspec.lock, package-lock.json
        - Cartella build/, .dart_tool/, node_modules/
        - Qualsiasi file con suffisso .g.dart generato automaticamente
        - Contenuto delle cartelle android/.gradle/ o ios/Pods/

---
### 9. ANTI-PATTERN DA EVITARE (OBBLIGATORIO)
---

    - NON utilizzare setState() in loop o callback asincroni senza controlli
    - NON creare widget con logica pesante nel metodo build()
    - NON fare chiamate API sincrone o senza timeout
    - NON hardcodare valori che potrebbero cambiare (usa costanti/config)
    - NON ignorare mai il caso null o liste vuote nei dati API
    - NON usare print() per log di produzione (solo per debug temporaneo)
    - NON duplicare logica: se una funzione e' usata 2+ volte, va estratta
    - NON modificare file generati automaticamente (es. .g.dart, build/)
    - NON usare .then() nidificati (preferire async/await)
    - NON creare liste con ListView normale per dati lunghi (usa .builder)
    - NON fare operazioni pesanti sul thread UI principale
    - NON usare asset PNG per icone (preferire vettoriali/IconData)

    VINCOLI TECNICI CRITICI:
        - Ogni chiamata HTTP deve avere un timeout esplicito (max 10s, 30s per IA).
        - Ogni widget riutilizzabile deve avere constructor const dove possibile.
        - Nessuna logica di business nel metodo build() dei widget.
        - Tutti i valori nullable devono essere gestiti con ?. o ??.
        - Import ordinati: Dart SDK -> Flutter -> Package esterni -> Relativi.
        - File sorgente non devono superare 500 righe (splitta in piu' moduli).

---
### 10. ESEMPI DI CODICE REFERENCE (Best Practice)
---

    #### ESEMPIO 1: Gestione Errori API (api_service.dart)

    CORRETTO: Gestione robusta con timeout, fallback su cache e log specifici.

    ```dart
    Future<Map<String, dynamic>> fetchForecast(double lat, double lon) async {
      final uri = Uri.parse('$_baseUrl/api/forecast?lat=$lat&lon=$lon');

      try {
        print('[ApiService Log] Chiamata a: $uri');
        final response = await http.get(uri).timeout(
          const Duration(seconds: 10),
          onTimeout: () => throw TimeoutException('API timeout dopo 10s'),
        );

        if (response.statusCode == 200) {
          print('[ApiService Log] Dati ricevuti correttamente');
          return json.decode(response.body) as Map<String, dynamic>;
        } else {
          print('[ApiService Log] Errore HTTP: ${response.statusCode}');
          throw ApiException('Server error: ${response.statusCode}');
        }
      } on TimeoutException catch (e) {
        print('[ApiService Log] Timeout: $e');
        return await _getCachedDataOrFallback(lat, lon);
      } catch (e) {
        print('[ApiService Log] ERRORE generico: $e');
        return await _getCachedDataOrFallback(lat, lon);
      }
    }
    ```

    #### ESEMPIO 2: Widget Performante e Riutilizzabile (data_pill.dart)

    CORRETTO: Widget const e stateless, che delega la logica complessa.

    ```dart
    class DataPill extends StatelessWidget {
      const DataPill({
        super.key,
        required this.label,
        required this.value,
        required this.unit,
        required this.heatmapColor,
      });

      final String label;
      final String value;
      final String unit;
      final Color heatmapColor;

      @override
      Widget build(BuildContext context) {
        return Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: heatmapColor.withOpacity(0.2),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(color: heatmapColor, width: 1.5),
          ),
          child: Column(
            children: [
              Text(label, style: TextStyle(fontSize: 12, color: Colors.white70)),
              const SizedBox(height: 4),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                  const SizedBox(width: 2),
                  Text(unit, style: TextStyle(fontSize: 12, color: Colors.white70)),
                ],
              ),
            ],
          ),
        );
      }
    }
    ```
---
### 11. CHECKLIST DI QUALITA (Pre-Commit / Pre-PR)
---
    Prima di finalizzare qualsiasi modifica, verificare ogni punto:

    CODICE:
      - [ ] Il codice e' stato formattato con `dart format .`?
      - [ ] L'analizzatore statico (`flutter analyze`) non riporta errori o warning?
      - [ ] Nessun anti-pattern della sezione 9 e' stato introdotto?
      - [ ] Le nuove funzioni/classi sono documentate (commenti in inglese)?
      - [ ] Sono stati aggiunti log di debug nei punti critici?

    PERFORMANCE:
      - [ ] I nuovi widget sono `const` dove possibile?
      - [ ] Le liste lunghe usano `ListView.builder` o `GridView.builder`?
      - [ ] Nessuna operazione pesante (JSON parsing) viene eseguita nel `build()`?

    UI/UX:
      - [ ] La UI e' responsive e non ha overflow?
      - [ ] Il contrasto testo/sfondo e' sufficiente?
      - [ ] Le animazioni sono fluide (verificato su device reale)?

---
### 12. WORKFLOW DIAGNOSTICO STANDARD
---
    In caso di bug, seguire rigorosamente questi passaggi:

    1. RICHIESTA LOG: Chiedere sempre e solo i log pertinenti.
    2. ANALISI LOG:
        - Cercare [ERRORE], [Timeout], [Exception], status HTTP != 200.
        - Identificare il componente che ha generato l'errore.
        - Verificare la conformita' dei dati ricevuti.
    3. RIPRODUZIONE ISOLATA: Tentare di riprodurre il bug con i parametri specifici.
    4. ISPEZIONE CODICE: Ispezionare la logica pertinente nel file sorgente.
    5. PROPOSTA SOLUZIONE: Fornire la modifica usando il template obbligatorio.
    6. VALIDAZIONE: Chiedere conferma della risoluzione tramite nuovi log.

---
### 13. MATRICE DECISIONALE TECNICA
---
    +------------------------------------+----------------------------------+--------------------------------------+------------------------------------------------------------------------------------------+
    | SCENARIO                           | OPZIONE A                        | OPZIONE B                            | DECISIONE GUIDATA                                                                        |
    +------------------------------------+----------------------------------+--------------------------------------+------------------------------------------------------------------------------------------+
    | Gestione Stato UI                  | StatefulWidget + setState        | Package esterno (es. Provider)       | USARE A per stato locale. USARE B per stato condiviso. In questo progetto, A e' preferito. |
    | Logica di Business nel Frontend    | Logica dentro al Widget          | Estrarla in un Service/Controller    | USARE SEMPRE B. SRP e testabilita' sono prioritari.                                      |
    | Aggiunta Nuova Funzionalita Backend| Modificare /api/forecast         | Creare un nuovo endpoint /api/tides  | USARE B per funzionalita' distinte. USARE A solo per arricchimenti minori.                |
    | Animazioni UI                      | AnimationController manuale      | Pacchetto (staggered_animations)     | USARE B per animazioni comuni. USARE A solo per animazioni complesse e personalizzate.   |
    +------------------------------------+----------------------------------+--------------------------------------+------------------------------------------------------------------------------------------+

---
### 14. TEMPLATE DI COMUNICAZIONE (Standard Output AI)
---

    ## OBIETTIVO
    *Una sintesi chiara e concisa di cio' che la richiesta vuole ottenere.*

    ## ANALISI
    *Il mio processo di pensiero. Spiego come ho interpretato il problema, i file analizzati (es. forecast_screen.dart, score.calculator.js) e le ragioni tecniche della soluzione, riferendomi ai principi del prompt (performance, estetica, anti-pattern, etc.).*

    ## SOLUZIONE PROPOSTA
    *Una descrizione ad alto livello della soluzione.*

    ## ISTRUZIONI DI IMPLEMENTAZIONE
    *Istruzioni passo-passo per applicare le modifiche. Ogni blocco di codice sara' presentato con il suo contesto.*

    ### lib/path/to/nome_file.dart
    ```dart
    // --- RIGA DI CODICE PRECENDENTE (INVARIATA, COME CONTESTO) ---
    [...codice esistente...]

    // --- NUOVO CODICE DA INCOLLARE (IN SOSTITUZIONE / IN AGGIUNTA) ---
    [...nuovo codice...]
    // --- FINE NUOVO CODICE ---

    // --- RIGA DI CODICE SUCCESSIVA (INVARIATA, COME CONTESTO) ---
    [...codice esistente...]
    ```
---
### 15. PRINCIPIO DI VERIFICA DEL CONTESTO (OBBLIGATORIO)
---

    REGOLA AUREA: Non fornire mai soluzioni basate su assunzioni. Prima di proporre modifiche al codice, l'AI DEVE verificare il contesto reale.

        15.1 PROTOCOLLO DI DOMANDE PRELIMINARI

            FASE 1: ANALISI DELLA RICHIESTA
                1. Identifica quali file/moduli sono potenzialmente coinvolti.
                2. Determina se le informazioni sono sufficienti.
                3. Se NO, passa alla FASE 2.

            FASE 2: RICHIESTA INFORMAZIONI MANCANTI
                - "Quale file contiene la logica X?"
                - "Puoi inviarmi la firma attuale del metodo Y?"
                - "Qual e' la struttura dati JSON della risposta di Z?"

            FASE 3: CONFERMA PRIMA DELLA SOLUZIONE
                1. Riepiloga brevemente cosa hai compreso.
                2. Indica esplicitamente quale file modificherai.
                3. Solo DOPO, procedi con il template della Sezione 14.

        15.2 ESEMPI DI APPLICAZIONE

            SCORRETTO (Fantasticare):
                Utente: "Il grafico non si aggiorna."
                AI: "Modifica _updateChart() in forecast_screen.dart..."

            CORRETTO (Verificare):
                Utente: "Il grafico non si aggiorna."
                AI: "Per diagnosticare, ho bisogno di sapere: In quale file e' il widget del grafico? Puoi inviarmi la sezione di codice che gestisce l'aggiornamento?"

        15.3 CASISTICHE DI VERIFICA OBBLIGATORIA
            - Modifiche/refactoring di codice esistente.
            - Risoluzione di bug.
            - Aggiunta di funzionalita' che si integrano con l'esistente.

        15.4 ECCEZIONI (Quando NON serve verificare)
            - Domande teoriche/concettuali.
            - Creazione di nuovi file da specifiche complete.
            - Spiegazioni di codice fornito dall'utente nel messaggio.

    PROMEMORIA CRITICO: La precisione chirurgica e' preferibile alla velocita' approssimativa.
"@
#endregion

#region ------------------ FUNZIONI DI HELPER E LOGICA DI ANALISI ------------------

$frontendKnowledgeBase = @{
    "lib/main.dart" = "Punto di ingresso principale dell'app. Inizializza Flutter e avvia la schermata principale."
    "lib/models/forecast_data.dart" = "Definisce il modello dati (`ForecastData`) che struttura tutte le informazioni ricevute dal backend."
    "lib/screens/forecast_screen.dart" = "Widget principale che rappresenta l'intera schermata delle previsioni. Gestisce lo stato e assembla i componenti UI."
    "lib/services/api_service.dart" = "Centralizza la comunicazione con il backend. Contiene la logica per le chiamate HTTP all'API."
    "lib/widgets/main_hero_module.dart" = "Widget 'eroe' che mostra le informazioni principali: località, temperatura e punteggio di pesca."
    "lib/widgets/hourly_forecast.dart" = "Widget che renderizza la lista orizzontale delle previsioni per le prossime ore."
    "lib/widgets/search_overlay.dart" = "Gestisce la UI di ricerca della località, mostrando suggerimenti e gestendo l'input utente."
    "lib/utils/weather_icon_mapper.dart" = "Contiene la logica per mappare i codici meteo (WMO) a icone visive specifiche."
    "lib/widgets/fishing_score_indicator.dart" = "Widget UI circolare che visualizza il punteggio di pesca con un indicatore colorato."
    "lib/widgets/glassmorphism_card.dart" = "Widget riutilizzabile che crea un pannello con l'effetto 'vetro smerigliato' (glassmorphism)."
    "lib/widgets/location_services_dialog.dart" = "Mostra un popup per informare l'utente sulla necessità di attivare i servizi di localizzazione."
    "lib/widgets/score_chart_dialog.dart" = "Mostra un popup contenente il grafico che visualizza l'andamento orario del punteggio di pesca."
    "lib/widgets/score_details_dialog.dart" = "Mostra un popup con i dettagli dei fattori (positivi/negativi) che hanno determinato il punteggio."
    "lib/widgets/stale_data_dialog.dart" = "Mostra un popup quando i dati meteo sono obsoleti e chiede all'utente se vuole continuare ad usarli."
    "lib/widgets/weekly_forecast.dart" = "Widget che renderizza la lista verticale delle previsioni per i giorni della settimana."
}

function Get-ItemDescription-Flutter($Item, $isLibSubfolder, $rootPath) {
    if ($isLibSubfolder) {
        $relativePath = $Item.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
        if ($frontendKnowledgeBase.ContainsKey($relativePath)) { return $frontendKnowledgeBase[$relativePath] }
    }
    if ($Item.Extension -eq ".dart" -and $isLibSubfolder) {
        try {
            $content = Get-Content -Path $Item.FullName -TotalCount 20; $description = ""
            foreach ($line in $content) {
                # CORREZIONE: Forziamo il risultato ad essere una stringa
                if ($line -match "^\s*///\s*(.+)") { $description = [string]$matches[1]; break }
                if ($line -match "^\s*//\s*(.+)") { if ($description -eq "") { $description = [string]$matches[1] } }
                if ($line -match "^\s*(abstract\s+class|class|@immutable\s+class|enum)\s+([A-Za-z0-9_]+)") {
                     if ($description -eq "") { $description = "Definizione della classe/widget: $($matches[2])." }
                }
            }
            if ($description -ne "") { return $description } else { return "File sorgente Dart con logica di supporto." }
        } catch { return "Impossibile leggere il contenuto del file Dart." }
    }
    switch -Wildcard ($Item.Name) {
        ".dart_tool"{ return "Cache e file interni generati dagli strumenti di sviluppo Dart." }; ".idea"{ return "File di configurazione specifici dell'IDE." }
        "android"{ return "Wrapper nativo Android; contiene il codice sorgente per l'app Android." }; "ios"{ return "Wrapper nativo iOS; contiene il progetto Xcode per l'app iOS." }
        "windows"{ return "Wrapper nativo Windows." }; "linux"{ return "Wrapper nativo Linux." }; "macos"{ return "Wrapper nativo macOS." }
        "web"{ return "Codice sorgente per la versione web." }; "assets"{ return "Risorse statiche come immagini e font." }; "build"{ return "Cartella di output per gli artefatti di compilazione." }
        "lib"{ return "Cuore dell'applicazione. Contiene tutto il codice sorgente Dart." }; "test"{ return "Contiene i file per i test automatici." }
        "models"{ return "Contiene le classi modello per i dati." }; "screens"{ return "Contiene le schermate complete." }
        "widgets"{ return "Contiene widget riutilizzabili." }; "services"{ return "Contiene la logica di business (chiamate API)." }; "utils"{ return "Contiene funzioni di utilità e helper." }
        ".gitignore"{ return "Specifica i file da ignorare nel controllo di versione." }; ".metadata"{ return "File generato da Flutter per tracciare le proprietà del progetto." }
        "pubspec.yaml"{ return "File di manifesto del progetto: definisce dipendenze, asset, etc." }; "pubspec.lock"{ return "File che blocca le versioni esatte delle dipendenze." }
        "analysis_options.yaml"{ return "Configura le regole di analisi statica del codice." }
        default {
            if ($Item.PSIsContainer) { return "Sottocartella." }
            switch ($Item.Extension) {
                ".json" { return "File di dati/configurazione JSON." }; ".md" { return "File di documentazione Markdown." }
                ".png" { return "File immagine PNG." }; ".jpg" { return "File immagine JPG." }
                default { if ([string]::IsNullOrEmpty($Item.Extension)) { return "File di configurazione." } else { return "File di tipo '$($Item.Extension)'." } }
            }
        }
    }
}

function Show-ProjectTree-Flutter($Path, $Prefix = "|-- ", $isLib = $false, $rootPathForDescriptions) {
    $output = New-Object System.Text.StringBuilder
    Get-ChildItem $Path | ForEach-Object {
        $item = $_; $isCurrentItemLib = $isLib -or ($item.Name -eq "lib" -and $item.PSIsContainer)
        $description = Get-ItemDescription-Flutter $item $isCurrentItemLib $rootPathForDescriptions
        if ($item.PSIsContainer) {
            [void]$output.AppendLine("$($Prefix)$($item.Name)/ # $description")
            if ($isCurrentItemLib) {
                # Prefisso ricorsivo per la cartella 'lib' (ricorsione completa)
                [void]$output.Append((Show-ProjectTree-Flutter $_.FullName ("$Prefix|   ") $true $rootPathForDescriptions))
            } else {
                # Elenco non ricorsivo per le altre cartelle di alto livello
                Get-ChildItem $_.FullName | ForEach-Object { if ($_.PSIsContainer) { [void]$output.AppendLine("$Prefix|   $($_.Name)/") } else { [void]$output.AppendLine("$Prefix|   $($_.Name)") } }
            }
        } else { [void]$output.AppendLine("$($Prefix)$($item.Name) # $description") }
    }
    return $output.ToString()
}

$backendKnowledgeBase = @{
    "server.js" = "Punto di ingresso principale dell'applicazione. Avvia il server Express e imposta le route."
    "lib" = "Contiene tutta la logica di business e i moduli core dell'applicazione."
    "lib/domain" = "Contiene la logica di business pura, slegata da API e dettagli implementativi."
    "lib/domain/score.calculator.js" = "Modulo dedicato al calcolo del pescaScore. Contiene la funzione che, dati i parametri meteo di una singola ora, calcola il punteggio numerico e le ragioni testuali."
    "lib/domain/window.calculator.js" = "Modulo responsabile del calcolo delle finestre di pesca ottimali. Contiene la funzione che, data una serie di punteggi orari, identifica e formatta le migliori fasce orarie (es. '07:00 - 09:00')."
    "lib/services" = "Contiene i moduli responsabili della comunicazione con le API esterne. Ogni file è uno 'specialista'."
    "lib/services/openmeteo.service.js" = "Gestisce le chiamate agli endpoint di Open-Meteo per recuperare i dati orari ad alta risoluzione (temperatura, vento, onde, etc.)."
    "lib/services/stormglass.service.js" = "Gestisce la chiamata all'API premium di Stormglass.io per ottenere dati marini di alta precisione (usato solo per località specifiche come Posillipo)."
    "lib/services/wwo.service.js" = "Gestisce la chiamata all'API di WorldWeatherOnline per recuperare i dati giornalieri di base, come astronomia (alba/tramonto) e maree."
    "lib/utils" = "Contiene funzioni di utilità pure, generiche e riutilizzabili in tutto il progetto."
    "lib/utils/cache.manager.js" = "Centralizza la configurazione e l'esportazione dell'istanza di node-cache, gestendo il Time-To-Live (TTL) di default."
    "lib/utils/formatter.js" = "Contiene tutte le funzioni di formattazione dei dati per la UI, come la conversione degli orari, la capitalizzazione delle stringhe e la determinazione dell'acronimo per lo stato del mare."
    "lib/utils/wmo_code_converter.js" = "Modulo specializzato nel 'tradurre' i codici meteo numerici (standard WMO di Open-Meteo) nelle icone emoji e nelle direzioni del vento testuali (es. 'NNE') attese dal client."
    "lib/forecast.assembler.js" = "Il 'maestro assemblatore'. Non contiene logica di business, ma orchestra i dati. Prende i dati grezzi e trasformati dai vari servizi e li combina nella struttura dati intermedia e unificata (unifiedForecastData)."
    "lib/forecast-logic.js" = "Il 'direttore d'orchestra' e punto d'ingresso principale per la logica di forecast. Gestisce la cache, decide quale fonte dati usare (Standard vs Premium), chiama l'assemblatore per unificare i dati, e infine invoca la logica di dominio per arricchire l'output con il pescaScore e le finestre di pesca, producendo il JSON finale per l'app."
    "tools/Update-ProjectDocs.ps1" = "Questo script. Genera e aggiorna la documentazione unificata nel README principale del progetto."
}

function Get-ItemDescription-Node($Item, $rootPath) {
    $relativePath = $Item.FullName.Substring($rootPath.Length + 1).Replace('\', '/')
    if ($backendKnowledgeBase.ContainsKey($relativePath)) { return $backendKnowledgeBase[$relativePath] }
    if ($Item.Extension -eq ".js") {
        try {
            $content = Get-Content -Path $Item.FullName -TotalCount 25; $description = ""
            foreach ($line in $content) {
                if ($line -match "^\s*/\*\*\s*(.+)") { $description = [string]$matches[1]; break }
                if ($line -match "^\s*//\s*(.+)") { if ($description -eq "") { $description = [string]$matches[1] } }
                if ($line -match "require\('express'\)") { if ($description -eq "") { $description = "Setup del server Express o di un router." } }
                if ($line -match "module\.exports") { if ($description -eq "") { $description = "Modulo che esporta funzionalità o dati." } }
            }
            if ($description -ne "") { return $description } else { return "File sorgente JavaScript." }
        } catch { return "Impossibile leggere il file JavaScript." }
    }
    switch -Wildcard ($Item.Name) {
        "node_modules"{ return "Contiene tutte le dipendenze (pacchetti npm)." }; "public"{ return "Contiene file statici serviti al client." }
        "api"{ return "Contiene i file che definiscono le route e la logica API." }; "package.json"{ return "File manifesto del progetto: dipendenze, script, etc." }
        "package-lock.json"{ return "Registra la versione esatta di ogni dipendenza." }
        "tools" { return "Contiene script e tool di supporto per lo sviluppo." }
        ".env"{ return "Contiene le variabili d'ambiente (dati sensibili)." }; ".gitignore"{ return "Specifica i file da ignorare nel controllo di versione." }
        default {
            if ($Item.PSIsContainer) { return "Sottocartella del server." } 
            switch ($Item.Extension) {
                ".json"{ return "File di dati/configurazione JSON." }; ".md"{ return "File di documentazione Markdown." }
                ".html"{ return "File HTML." }; ".css"{ return "Foglio di stile CSS." }
                default { if ([string]::IsNullOrEmpty($Item.Extension)) { return "File di configurazione." } else { return "File di tipo '$($Item.Extension)'." } }
            }
        }
    }
}

function Show-ProjectTree-Node($Path, $Prefix = "|-- ", $rootPathForDescriptions) {
    $output = New-Object System.Text.StringBuilder
    Get-ChildItem $Path -Exclude "node_modules", "pesca_app" | ForEach-Object {
        $item = $_
        $description = Get-ItemDescription-Node $item $rootPathForDescriptions
        
        if ($item.PSIsContainer) {
            [void]$output.AppendLine("$($Prefix)$($item.Name)/ # $description")
            # CORREZIONE LOGICA: Calcola il prefisso per il livello successivo.
            # Sostituisce l'indicatore di ramo '`|-- `' con l'indicatore di continuità '|   '
            $nextBranchPrefix = $Prefix -replace '\|-- ', '\|   '
            $nextPrefix = $nextBranchPrefix + '|-- '
            
            [void]$output.Append((Show-ProjectTree-Node $_.FullName $nextPrefix $rootPathForDescriptions))
        } else { [void]$output.AppendLine("$($Prefix)$($item.Name) # $description") }
    }
    return $output.ToString()
}

#endregion

#region ------------------ FUNZIONE CORE DI AGGIORNAMENTO FILE ------------------

function Update-ReadmeFile {
    param(
        [string]$readmePath,
        [string]$contentToInject
    )
    $utf8Encoding = New-Object System.Text.UTF8Encoding($true)
    $fullContentToInject = "`n$startMarker`n" + $contentToInject + "`n$endMarker`n"
    if (-not (Test-Path $readmePath)) {
        Write-Host "File README.md non trovato in '$readmePath'. Verrà creato." -ForegroundColor Yellow
        [System.IO.File]::WriteAllLines($readmePath, $fullContentToInject, $utf8Encoding)
        return
    }
    $readmeContent = [System.IO.File]::ReadAllText($readmePath, [System.Text.Encoding]::UTF8)
    $startMarkerEscaped = [regex]::Escape($startMarker)
    $endMarkerEscaped = [regex]::Escape($endMarker)
    if ($readmeContent -match "(?s)$startMarkerEscaped.*$endMarkerEscaped") {
        $newReadmeContent = $readmeContent -replace "(?s)$startMarkerEscaped.*$endMarkerEscaped", $fullContentToInject
    } else {
        $newReadmeContent = $readmeContent.TrimEnd() + "`n" + $fullContentToInject
    }
    [System.IO.File]::WriteAllText($readmePath, $newReadmeContent, $utf8Encoding)
    Write-Host "File '$readmePath' aggiornato con successo!" -ForegroundColor Green
}

#endregion

# ==============================================================================
#                     BLOCCO DI ESECUZIONE PRINCIPALE
# ==============================================================================

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  Avvio script di aggiornamento documentazione unificata  " -ForegroundColor Cyan
Write-Host "=========================================================="

try {
    $OutputEncoding = [System.Text.Encoding]::UTF8
    $scriptFullPath = $MyInvocation.MyCommand.Path
    $toolsDir = Split-Path -Parent $scriptFullPath
    $beProjectDir = Split-Path -Parent $toolsDir
    $workspaceDir = Split-Path -Parent $beProjectDir
    
    $feProjectPath = Join-Path $workspaceDir "pesca_app"
    $beProjectPath = $beProjectDir
    $targetReadmePath = Join-Path $feProjectPath "README.md"

    if (-not (Test-Path $feProjectPath -PathType Container) -or -not (Test-Path $beProjectPath -PathType Container)) {
        throw "ERRORE: Impossibile trovare le cartelle 'pesca_app' e 'pesca-api' nella directory '$workspaceDir'."
    }
    Write-Host "Workspace trovato in: $workspaceDir" -ForegroundColor Gray

    $backendTitleMarker = "3. ORGANIZZAZIONE DEI MICROSERVIZI (BACKEND)"
    $titleIndex = $ContextPrompt.IndexOf($backendTitleMarker)
    if ($titleIndex -lt 0) { throw "ERRORE: Impossibile trovare il titolo del backend ('$backendTitleMarker') nel prompt." }
    $separatorLine = "----------------------------------------------------------------------"
    $splitIndex = $ContextPrompt.LastIndexOf($separatorLine, $titleIndex)
    if ($splitIndex -lt 0) { throw "ERRORE: Impossibile trovare la linea '---' prima del titolo del backend." }
    
    $frontendDescription = $ContextPrompt.Substring(0, $splitIndex).Trim()
    $backendDescription = $ContextPrompt.Substring($splitIndex).Trim()

    Write-Host "`n[1/3] Generazione documentazione Frontend in corso..." -ForegroundColor White
    $feTree = Show-ProjectTree-Flutter $feProjectPath -rootPathForDescriptions $feProjectPath
    
    Write-Host "[2/3] Generazione documentazione Backend in corso..." -ForegroundColor White
    $beTree = Show-ProjectTree-Node $beProjectPath -rootPathForDescriptions $beProjectPath
    
    $finalContentBuilder = New-Object System.Text.StringBuilder
    [void]$finalContentBuilder.AppendLine($ContextPrompt)
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine("---")
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine("## STRUTTURA DETTAGLIATA DEL PROGETTO (Auto-generata)")
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine('### Frontend: `pesca_app`')
    [void]$finalContentBuilder.AppendLine('La seguente è una rappresentazione commentata della struttura attuale del progetto frontend:')
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine('```')
    [void]$finalContentBuilder.Append($feTree)
    [void]$finalContentBuilder.AppendLine('```')
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine('### Backend: `pesca-api`')
    [void]$finalContentBuilder.AppendLine('La seguente è una rappresentazione commentata della struttura attuale del progetto backend, arricchita con la conoscenza architetturale:')
    [void]$finalContentBuilder.AppendLine()
    [void]$finalContentBuilder.AppendLine('```')
    [void]$finalContentBuilder.Append($beTree)
    [void]$finalContentBuilder.AppendLine('```')
    
    Write-Host "[3/3] Scrittura del README.md unificato in corso..." -ForegroundColor White
    Update-ReadmeFile -readmePath $targetReadmePath -contentToInject $finalContentBuilder.ToString()

    Write-Host "`n==========================================================" -ForegroundColor Cyan
    Write-Host "          AGGIORNAMENTO COMPLETATO CON SUCCESSO!        " -ForegroundColor Cyan
    Write-Host "=========================================================="

} catch {
    Write-Host "`n!!!!!!!!!! ERRORE DURANTE L'ESECUZIONE !!!!!!!!!!`n" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "`n==========================================================" -ForegroundColor Red
}