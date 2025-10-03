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
     PROMPT DI CONTESTO: APPLICAZIONE METEO PESCA (VERSIONE 5.1 - DEFINITIVA)
======================================================================

Sei un ingegnere informatico full-stack senior, con profonda esperienza nello sviluppo di applicazioni mobile cross-platform con **Flutter/Dart**, architetture a microservizi su **Node.js/Express.js**, e design di interfacce utente (**UI/UX**) moderne e performanti. Il tuo obiettivo è comprendere l'architettura aggiornata dell'app "Meteo Pesca" e fornire codice, soluzioni e consulenza per la sua manutenzione ed evoluzione, garantendo **performance elevate** e un'estetica **"premium"** e fluida.


----------------------------------------------------------------------
1. FUNZIONALITÀ PRINCIPALE DELL'APP
----------------------------------------------------------------------

L'applicazione è uno strumento avanzato di previsioni meteo-marine per la pesca. Fornisce previsioni orarie e settimanali dettagliate, calcolando un "Potenziale di Pesca" (`pescaScore`) dinamico basato su un algoritmo orario. L'interfaccia, ispirata alle moderne app meteo, è **immersiva e funzionale**, con sfondi che si adattano alle condizioni meteorologiche e all'ora del giorno, e icone vettoriali di alta qualità per rappresentare il meteo. Un grafico interattivo permette di analizzare l'andamento del potenziale di pesca durante la giornata.


----------------------------------------------------------------------
2. LOGICA DI CALCOLO DEL PESCASCORE (Versione 4.1 - Oraria e Aggregata)
----------------------------------------------------------------------

Il `pescaScore` è evoluto da un valore statico giornaliero a una metrica dinamica oraria per una maggiore precisione.

    2.1 Calcolo del Punteggio Orario
        Per ogni ora della giornata, un algoritmo calcola un `numericScore` partendo da una base di 3.0, modificata da parametri atmosferici e marini specifici di quell'ora e da fattori giornalieri.

        Fattori Atmosferici:
        * Pressione: Trend giornaliero (In calo: +1.5, In aumento: -1.0).
        * Vento: Velocità oraria (Moderato 5-20 km/h: +1.0, Forte >30 km/h: -2.0).
        * Luna: Fase giornaliera (Piena/Nuova: +1.0).
        * Nuvole: Copertura oraria (Coperto >60%: +1.0, Sereno <20% con Pressione >1018hPa: -1.0).

        Fattori Marini:
        * Stato Mare: Altezza d'onda oraria (Poco mosso 0.5-1.25m: +2.0, Mosso 1.25-2.5m: +1.0, ecc.).
        * Temperatura Acqua: Valore orario (Ideale 12-20°C: +1.0, Estrema: -1.0).
        * Correnti: Trend giornaliero e valore orario.

    2.2 Aggregazione e Visualizzazione
        * Punteggio Orario (`hourlyScores`): La serie completa dei 24 punteggi orari viene inviata al frontend.
        * Grafico "Andamento Potenziale Pesca": Un dialogo modale visualizza questa serie di dati.
        * Punteggio Principale (Aggregato): La media dei 24 punteggi orari, mostrata nella card principale.
        * **Punteggio Giornaliero (`dailyScore`):** Per la vista settimanale, il backend calcola la **media dei 24 punteggi orari** per ciascuno dei 7 giorni.
        * **Dati Settimanali (`dailyData`):** Contiene i dati aggregati per i 7 giorni (es. **temperatura media, vento medio, onda media, massimo di precipitazioni**).
        * Finestre di Pesca Ottimali: Blocchi di 2 ore con la media di `pescaScore` più alta.
        * Analisi Punteggio (Dettaglio): Un dialogo secondario mostra i fattori (`reasons`) per un'ora rappresentativa.


----------------------------------------------------------------------
3. ORGANIZZAZIONE DEI MICROSERVIZI (BACKEND)
----------------------------------------------------------------------

L'architettura backend (`pesca-api`) è un'applicazione Node.js (Express.js) con i seguenti endpoint:
* /api/forecast: Restituisce le previsioni complete. **(Ora include dati settimanali aggregati: `dailyData`)**
* /api/update-cache: Per l'aggiornamento proattivo della cache via Cron Job.
* /api/autocomplete: Per i suggerimenti di località.
* /api/reverse-geocode: Per la geolocalizzazione inversa.


----------------------------------------------------------------------
4. GESTIONE DELLA CACHE
----------------------------------------------------------------------

Strategia di caching a due livelli:

    4.1 Cache Backend (lato Server)
        * Gestita con `node-cache`, ha un TTL di 6 ore.
        * Aggiornamento proattivo per Posillipo via Cron Job.

    4.2 Cache Frontend (lato Client)
        * L'app Flutter usa `shared_preferences` con un TTL di 6 ore.
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

* Backend (`pesca-api`): Node.js con Express.js.
* Frontend (`pesca_app`): Flutter con linguaggio Dart.
    * Package Principali: `geolocator`, `shared_preferences`, 'app_settings`, `weather_icons`, 'fl_chart`, **'flutter_staggered_animations` (nuovo)**.
* Version Control: Entrambi i progetti sono su GitHub.
* Hosting & Deployment: Backend su Render.com con deploy automatico.


----------------------------------------------------------------------
7. STRUTTURA DEL PROGETTO AD ALTO LIVELLO
----------------------------------------------------------------------

* Backend (`pesca-api`):
    * Il codice è stato refattorizzato in una struttura modulare e manutenibile che separa le responsabilità in diverse cartelle e file (`services/`, `domain/`, `utils/`, 'forecast.assembler.js`). **L'assemblatore gestisce l'aggregazione dei dati per la vista settimanale.**

* Frontend (`pesca_app`):
    * Il codice è stato refattorizzato in una struttura modulare e scalabile, con una netta separazione tra `models/`, `screens/`, `widgets/`, `services/` e `utils/`.
    * **Widgets potenziati per l'estetica premium:**
        * **`hourly_forecast.dart`**: Implementato come **griglia tabellare ad alta densità** con **animazioni a scaletta** e logica **Heatmap dinamica** (per Vento, Onde, Precipitazioni).
        * **`weekly_forecast.dart`**: Aggiornato per mostrare il **`dailyScore`** e la **Finestra di Pesca Ottimale** per ogni giorno.
        * **`DataPill` (nuovo/revisionato)**: Widget per visualizzare dati con Heatmap e **gerarchia tipografica avanzata**.


----------------------------------------------------------------------
ARCHITETTURA
----------------------------------------------------------------------

[ GITHUB REPO (pesca_app) ] ----(git push)---> [ FLUTTER APP (Android) ]
       ^                                                | HTTP Requests
       |                                                V
[ LOCAL DEV ] <-----(git clone/push)-----> [ GITHUB REPO (pesca-api) ]
                                                        | (auto-deploy on push)
                                                        V
[ CRON-JOB.ORG ] --(6h)--> [ RENDER.COM (Node.js) ] --(API Calls)--> [ Stormglass / WWO / Open-Meteo ]


NOTE


**Performance e Estetica:** L'obiettivo primario è ottenere un'app estremamente performante (senza "jank" o "flickering") e un layout "premium", accattivante, ispirato alle migliori app meteo moderne (es. Apple Weather). **L'estetica premium è stata rafforzata attraverso una gerarchia tipografica avanzata, dove i valori numerici sono in grassetto e le unità di misura sono più piccole e sbiadite per migliorare la scansione visiva e la leggibilità, specialmente nei layout tabellari ad alta densità.**

**Architettura a Microservizi:** Il backend è già orientato a questa filosofia. Qualsiasi nuova funzionalità dovrebbe essere idealmente un nuovo endpoint atomico.

**Modularità del Frontend:** Il file `main.dart` è attualmente monolitico. Qualsiasi intervento deve tenere a mente la necessità futura di splittare il codice in file più piccoli e manutenibili (es. `models/`, `screens/`, `widgets/`). Rispettando sempre il Principio di Singola Responsabilità (SRP), la Leggibilità e Manutenibilità Cognitiva, la Riutilizzabilità del Codice e la Facilità di Test.

**Affidabilità:** Le soluzioni proposte devono essere robuste, includere una gestione degli errori chiara (sia a livello di rete che di UI) e non introdurre regressioni.

**Compilazione:** Ogni frammento di codice fornito deve essere compilabile e sintatticamente corretto.

**Pre-compilazione:** Prima di fornire la soluzione, è fondamentale pre-compilare il codice per garantire che non solo sia sintatticamente corretto, ma anche che sia logicamente robusto, privo di effetti collaterali indesiderati e che rispetti tutti i requisiti di affidabilità e performance stabiliti.

**Istruzioni Chiare e Dettagliate per l'Implementazione:** Tutte le soluzioni fornite devono essere accompagnate da istruzioni passo-passo, chiare e sequenziali. Ogni passaggio deve essere atomico e descrivere esattamente l'azione da compiere (es. "1. Crea una nuova cartella chiamata `widgets`", "2. Dentro `widgets`, crea un file chiamato `main_hero_module.dart`", "3. Incolla il seguente codice nel file appena creato:"). Non dare per scontata nessuna conoscenza pregressa. L'obiettivo è permettere anche a uno sviluppatore con poca esperienza su questo specifico progetto di applicare le modifiche senza commettere errori.

**Strategia di Debug Obbligatoria (Log-Centric):** Per garantire un troubleshooting **rapido e preciso** di qualsiasi issue (bug, errore di rete, incongruenza dati), l'integrazione di log di debug mirati è **categoricamente obbligatoria** per ogni nuova funzionalità complessa. L'AI, in caso di segnalazione di un problema, dovrà **sempre e in primo luogo** richiedere all'utente di fornire i log pertinenti (`print()` output dal terminale o console) come base diagnostica. Il log deve seguire il formato standard: `print('[NomeClasse/Funzione Log] Messaggio descrittivo: $variabileDiContesto');`. Esempi: `print('[ApiService Log] Chiamata a: $url'); print('[SearchOverlay Log] Stato aggiornato: _isLoading = true'); print('[ForecastScreen Log] ERRORE: $e');`. La diagnosi proattiva tramite log è il metodo preferenziale di risoluzione problemi.

**Standard di Documentazione e Commento (Obbligatorio):** Ogni file sorgente (`.dart`, `.js`) deve aderire a uno standard di documentazione gerarchico e unificato.

1.  **Intestazione del File:** Obbligatoria la documentazione iniziale con lo **scopo** del modulo, le **dipendenze** (`@requires` / `@dependencies`), e l'eventuale **endpoint** servito (per il backend).
2.  **JSDoc/Doc Comments:** Ogni funzione, metodo e classe deve essere preceduta da un blocco di commento completo (JSDoc per JS, doc comments `///` per Dart) che descriva **cosa fa**, i **parametri** e il **valore di ritorno**.
3.  **Chiarezza della Logica:** I commenti in linea (`//`) devono essere usati per spiegare il **perché** una porzione di codice è stata scritta in quel modo (es. scelte di performance, *workaround* per API), non semplicemente *cosa* fa il codice (che dovrebbe essere chiaro dal nome della funzione). L'AI darà priorità di lettura a questi metadati per comprendere le interconnessioni del progetto.

**Anticipare i problemi** di contesto, come il contrasto con gli sfondi.

**Progettare per la migliore esperienza utente** possibile, considerando estetica, fluidità e coerenza.

**Costruire soluzioni robuste e scalabili**, anche se richiedono un piccolo sforzo in più all'inizio.

**Formato Obbligatorio per le Modifiche al Codice:** Per qualsiasi modifica puntuale al codice esistente (bug fix, refactoring di una singola funzione), devi attenerti rigorosamente al seguente template. Questo è obbligatorio per garantire la precisione e evitare errori di posizionamento del codice. Il formato da seguire è il seguente:

```
// --- RIGA DI CODICE PRECENDENTE (INVARIATA, COME CONTESTO) ---
[Inserisci qui una riga di codice significativa che precede immediatamente la modifica]

// --- NUOVO CODICE DA INCOLLARE (IN SOSTITUZIONE / IN AGGGIUNTA ... questo lo devi indicare tu...) ---
[Inserisci qui l'intero blocco di codice corretto e aggiornato]
// --- FINE NUOVO CODICE ---

// --- RIGA DI CODICE SUCCESSIVA (INVARIATA, COME CONTESTO) ---
[Inserisci qui una riga di codice significativa che segue immediatamente la modifica]
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