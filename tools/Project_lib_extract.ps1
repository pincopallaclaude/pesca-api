# ==============================================================================
#           SCRIPT GENERAZIONE CONTESTO AI-OPTIMIZED (DYNAMIC)
#                     Progetto: Meteo Pesca
# Versione: 3.1 (Hybrid: KB + Filesystem Scan + Code Parsing)
# Output: Desktop/meteo-pesca-ai-context.txt
# ==============================================================================

#region ------------------ KNOWLEDGE BASE ARRICCHITA (OPZIONALE) ------------------

# Knowledge Base manuale per file critici con dettagli extra
# Se un file NON è qui, verrà comunque rilevato e analizzato automaticamente
$frontendKB = @{
    "lib/main.dart" = @{
        Classes = @("MyApp")
        Methods = @()
        Notes = "Inizializza Flutter, configura MaterialApp, avvia ForecastScreen"
    }
    "lib/models/forecast_data.dart" = @{
        Classes = @("ForecastData", "HourlyData", "DailyData", "FishingScore", "AstronomyData", "TideData")
        Methods = @()
        Notes = "Serializzazione JSON con factory constructors. Modello immutabile"
    }
    "lib/screens/forecast_screen.dart" = @{
        Classes = @("ForecastScreen (StatefulWidget)", "_ForecastScreenState")
        Methods = @("_fetchData()", "_showAnalystOverlay()", "_handleRefresh()")
        Notes = "Gestisce PageView, pull-to-refresh, error states"
    }
    "lib/services/api_service.dart" = @{
        Classes = @("ApiService")
        Methods = @("fetchForecastData(lat, lon)", "fetchAnalysis(lat, lon, lang)")
        Notes = "Usa http package. Timeout: 15s. Cache-aware"
    }
    "lib/widgets/analyst_card.dart" = @{
        Classes = @("AnalystCard (StatefulWidget)", "_AnalystCardState")
        Methods = @("_buildMarkdownStyleSheet()", "_animateEntry()")
        Notes = "Custom StyleSheet, palette calda Premium Plus. Usa flutter_markdown"
    }
    "lib/widgets/main_hero_module.dart" = @{
        Classes = @("MainHeroModule", "_PulsingIcon (AnimatedWidget)")
        Methods = @("_triggerAnalysis()")
        Notes = "Gestisce tap su AI icon → apre AnalystCard overlay"
    }
    "lib/widgets/glassmorphism_card.dart" = @{
        Classes = @("GlassmorphismCard")
        Methods = @()
        Notes = "Widget riutilizzabile. Parametri: blurStrength, opacity, borderRadius"
    }
    "lib/widgets/hourly_forecast.dart" = @{
        Classes = @("HourlyForecast")
        Methods = @("_buildHeatmapColor(value, type)", "_buildHourCard()")
        Notes = "Animazioni cascade. Usa ListView.builder per performance"
    }
}

$backendKB = @{
    "server.js" = @{
        Functions = @("startServer()")
        Notes = "Port: 3000 (default). CORS enabled. Body-parser JSON"
    }
    "lib/forecast-logic.js" = @{
        Functions = @("getUnifiedForecastData(lat, lon)")
        Notes = "Output: ForecastData completo. Integra tutti i services. Cache TTL: 3600s"
    }
    "lib/forecast.assembler.js" = @{
        Functions = @("assembleForecastData(openMeteoData, wwoData, stormglassData)")
        Notes = "Trasformazione: API raw → intermediate unified format"
    }
    "lib/domain/score.calculator.js" = @{
        Functions = @("calculateFishingScore(weatherData)")
        Notes = "Fattori: vento, onde, pressione, temp, fase lunare. Logica pesata"
    }
    "lib/domain/window.calculator.js" = @{
        Functions = @("findOptimalWindows(hourlyScores)")
        Notes = "Output: array di {start, end, avgScore}. Sliding window algorithm"
    }
    "lib/domain/knowledge_base.js" = @{
        Data = @("KNOWLEDGE_BASE (array)")
        Notes = "Topic: specie ittiche, tecniche, maree, correnti. Usato per embedding"
    }
    "lib/services/openmeteo.service.js" = @{
        Functions = @("fetchWeatherData(lat, lon)")
        Notes = "API: api.open-meteo.com. Free tier. Forecast: 7 giorni, 168 ore"
    }
    "lib/services/stormglass.service.js" = @{
        Functions = @("fetchMarineData(lat, lon)")
        Notes = "API: stormglass.io. Quota limitata. Solo località specifiche"
    }
    "lib/services/wwo.service.js" = @{
        Functions = @("fetchAstronomyData(lat, lon)")
        Notes = "API: worldweatheronline.com. 7 giorni. Include moon phase"
    }
    "lib/services/gemini.service.js" = @{
        Functions = @("generateAnalysis(context, facts)", "batchEmbedContents(texts)")
        Notes = "Model: gemini-pro. Embedding: text-embedding-004. Rate limits"
    }
    "lib/services/vector.service.js" = @{
        Functions = @("queryKnowledgeBase(query, topK)")
        Notes = "Input: query string → Output: top K documenti. cosine similarity"
    }
    "lib/utils/cache.manager.js" = @{
        Exports = @("cacheInstance")
        Notes = "TTL: 3600s. maxKeys: 100. checkperiod: 600s"
    }
    "lib/utils/formatter.js" = @{
        Functions = @("formatTime()", "capitalize()", "getSeaStateAcronym()")
        Notes = "Pure functions. Stateless"
    }
    "lib/utils/wmo_code_converter.js" = @{
        Functions = @("convertWMOCode(code)", "getWindDirection(degrees)")
        Notes = "Mapping statico. WMO codes: 0-99"
    }
}

#endregion

#region ------------------ FUNZIONI ANALISI DINAMICA CODICE ------------------

function Extract-DartInfo {
    param([string]$FilePath)
    
    $info = @{
        Description = ""
        Classes = @()
        Methods = @()
    }
    
    try {
        $content = Get-Content -Path $FilePath -TotalCount 50 -ErrorAction Stop
        
        foreach ($line in $content) {
            # Estrai commenti descrittivi
            if ($line -match "^\s*///\s*(.+)" -and $info.Description -eq "") {
                $info.Description = [string]$matches[1]
            } elseif ($line -match "^\s*//\s*(.+)" -and $info.Description -eq "") {
                $info.Description = [string]$matches[1]
            }
            
            # Estrai classi/widget
            if ($line -match "^\s*(?:abstract\s+)?class\s+([A-Za-z0-9_]+)") {
                $info.Classes += $matches[1]
            } elseif ($line -match "^\s*enum\s+([A-Za-z0-9_]+)") {
                $info.Classes += "$($matches[1]) (enum)"
            }
            
            # Estrai metodi pubblici (semplificato)
            if ($line -match "^\s*(?:Future<[^>]+>|void|Widget|String|int|double|bool)\s+([a-z][A-Za-z0-9_]*)\s*\(") {
                $methodName = $matches[1]
                if ($methodName -notlike "_*" -and $methodName -notin @("build", "createState")) {
                    $info.Methods += "$methodName()"
                }
            }
        }
        
        # Fallback description
        if ($info.Description -eq "") {
            if ($info.Classes.Count -gt 0) {
                $info.Description = "Definisce: " + ($info.Classes -join ", ")
            } else {
                $info.Description = "Modulo Dart"
            }
        }
    } catch {
        $info.Description = "File Dart (impossibile leggere)"
    }
    
    return $info
}

function Extract-JSInfo {
    param([string]$FilePath)
    
    $info = @{
        Description = ""
        Functions = @()
        Exports = @()
    }
    
    try {
        $content = Get-Content -Path $FilePath -TotalCount 50 -ErrorAction Stop
        
        foreach ($line in $content) {
            # Estrai commenti JSDoc o inline
            if ($line -match "^\s*/\*\*\s*(.+)" -and $info.Description -eq "") {
                $info.Description = [string]$matches[1] -replace "\*/$", ""
            } elseif ($line -match "^\s*//\s*(.+)" -and $info.Description -eq "") {
                $info.Description = [string]$matches[1]
            }
            
            # Estrai funzioni esportate
            if ($line -match "(?:export\s+)?(?:async\s+)?function\s+([a-z][A-Za-z0-9_]*)\s*\(([^)]*)\)") {
                $funcName = $matches[1]
                $params = $matches[2] -replace "\s+", ""
                $info.Functions += "$funcName($params)"
            }
            
            # Estrai arrow functions esportate
            if ($line -match "(?:export\s+)?const\s+([a-z][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>") {
                $funcName = $matches[1]
                $params = $matches[2] -replace "\s+", ""
                $info.Functions += "$funcName($params)"
            }
            
            # Estrai exports
            if ($line -match "module\.exports\s*=\s*\{?\s*([^}]+)") {
                $exports = $matches[1] -split "," | ForEach-Object { $_.Trim() }
                $info.Exports += $exports
            }
        }
        
        # Fallback description
        if ($info.Description -eq "") {
            if ($info.Functions.Count -gt 0) {
                $info.Description = "Modulo con funzioni: " + (($info.Functions | Select-Object -First 2) -join ", ")
            } else {
                $info.Description = "Modulo JavaScript"
            }
        }
    } catch {
        $info.Description = "File JS (impossibile leggere)"
    }
    
    return $info
}

#endregion

#region ------------------ SCANSIONE DINAMICA + KB MERGE ------------------

function Scan-ProjectFiles {
    param(
        [string]$BasePath,
        [string]$ProjectType, # "Flutter" o "Node"
        [hashtable]$KnowledgeBase,
        [string[]]$ExcludeFolders = @()
    )
    
    $fileMap = @{}
    $targetExt = if ($ProjectType -eq "Flutter") { ".dart" } else { ".js" }
    
    Get-ChildItem -Path $BasePath -Recurse -File -Include "*$targetExt" | ForEach-Object {
        $file = $_
        
        # Skip cartelle escluse
        $shouldSkip = $false
        foreach ($exclude in $ExcludeFolders) {
            if ($file.FullName -like "*$exclude*") {
                $shouldSkip = $true
                break
            }
        }
        if ($shouldSkip) { return }
        
        $relativePath = $file.FullName.Substring($BasePath.Length + 1).Replace('\', '/')
        
        # Estrai info dal codice
        $extractedInfo = if ($ProjectType -eq "Flutter") {
            Extract-DartInfo $file.FullName
        } else {
            Extract-JSInfo $file.FullName
        }
        
        # Merge con KB se presente
        $finalInfo = @{
            Description = $extractedInfo.Description
            Classes = $extractedInfo.Classes
            Methods = if ($extractedInfo.Methods) { $extractedInfo.Methods } else { @() }
            Functions = if ($extractedInfo.Functions) { $extractedInfo.Functions } else { @() }
            Exports = if ($extractedInfo.Exports) { $extractedInfo.Exports } else { @() }
            Notes = ""
        }
        
        if ($KnowledgeBase.ContainsKey($relativePath)) {
            $kbEntry = $KnowledgeBase[$relativePath]
            
            # Override con info da KB (più affidabili)
            if ($kbEntry.Classes) { $finalInfo.Classes = $kbEntry.Classes }
            if ($kbEntry.Methods) { $finalInfo.Methods = $kbEntry.Methods }
            if ($kbEntry.Functions) { $finalInfo.Functions = $kbEntry.Functions }
            if ($kbEntry.Exports) { $finalInfo.Exports = $kbEntry.Exports }
            if ($kbEntry.Notes) { $finalInfo.Notes = $kbEntry.Notes }
        }
        
        $fileMap[$relativePath] = $finalInfo
    }
    
    return $fileMap
}

#endregion

#region ------------------ GENERAZIONE OUTPUT AI-STYLE ------------------

function Build-AIStyleSection {
    param([hashtable]$FileMap, [string]$SectionTitle)
    
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("### $SectionTitle")
    [void]$sb.AppendLine()
    
    # Raggruppa per cartella
    $grouped = @{}
    foreach ($path in $FileMap.Keys | Sort-Object) {
        $folder = Split-Path $path -Parent
        if ([string]::IsNullOrEmpty($folder)) { $folder = "ROOT" }
        $folder = $folder -replace "\\", "/"
        if (-not $grouped.ContainsKey($folder)) { $grouped[$folder] = @() }
        $grouped[$folder] += $path
    }
    
    foreach ($folder in ($grouped.Keys | Sort-Object)) {
        # Header cartella
        $folderName = if ($folder -eq "ROOT") { "Root Level" } else { "``$folder/``" }
        [void]$sb.AppendLine("**$folderName**")
        [void]$sb.AppendLine()
        
        foreach ($filePath in ($grouped[$folder] | Sort-Object)) {
            $item = $FileMap[$filePath]
            $fileName = Split-Path $filePath -Leaf
            
            # Riga principale: file → Elements
            $mainLine = "- ``$fileName``"
            
            $elements = @()
            if ($item.Classes -and $item.Classes.Count -gt 0) { $elements += $item.Classes }
            if ($item.Functions -and $item.Functions.Count -gt 0) { $elements += $item.Functions }
            if ($item.Exports -and $item.Exports.Count -gt 0) { $elements += $item.Exports }
            
            if ($elements.Count -gt 0) {
                $mainLine += " → " + ($elements -join ", ")
            }
            [void]$sb.AppendLine($mainLine)
            
            # Descrizione
            if ($item.Description) {
                [void]$sb.AppendLine("  - $($item.Description)")
            }
            
            # Methods (se presenti e diversi da Functions)
            if ($item.Methods -and $item.Methods.Count -gt 0) {
                [void]$sb.AppendLine("  - Methods: " + ($item.Methods -join ", "))
            }
            
            # Note
            if ($item.Notes) {
                [void]$sb.AppendLine("  - $($item.Notes)")
            }
            
            [void]$sb.AppendLine()
        }
    }
    
    return $sb.ToString()
}

function Build-DataFlowSection {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("## FLUSSI DATI CRITICI")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**Forecast Flow**")
    [void]$sb.AppendLine("``````")
    [void]$sb.AppendLine("User → ForecastScreen._fetchData()")
    [void]$sb.AppendLine("    → ApiService.fetchForecastData(lat, lon)")
    [void]$sb.AppendLine("        → Backend /forecast")
    [void]$sb.AppendLine("            → getUnifiedForecastData()")
    [void]$sb.AppendLine("                → [Cache check]")
    [void]$sb.AppendLine("                → Parallel: openmeteo.service + wwo.service + stormglass.service")
    [void]$sb.AppendLine("                → forecast.assembler.assembleForecastData()")
    [void]$sb.AppendLine("                → score.calculator.calculateFishingScore() [ogni ora]")
    [void]$sb.AppendLine("                → window.calculator.findOptimalWindows()")
    [void]$sb.AppendLine("            → Response: ForecastData JSON")
    [void]$sb.AppendLine("        → Parse: forecast_data.dart")
    [void]$sb.AppendLine("    → UI render: MainHeroModule + HourlyForecast + WeeklyForecast")
    [void]$sb.AppendLine("``````")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**RAG Analysis Flow**")
    [void]$sb.AppendLine("``````")
    [void]$sb.AppendLine("User click AI → MainHeroModule._triggerAnalysis()")
    [void]$sb.AppendLine("    → forecast_screen: _showAnalystOverlay() [modal focus]")
    [void]$sb.AppendLine("        → ApiService.fetchAnalysis(lat, lon, query)")
    [void]$sb.AppendLine("            → Backend /analysis")
    [void]$sb.AppendLine("                → vector.service.queryKnowledgeBase(query, topK=5)")
    [void]$sb.AppendLine("                    → ChromaDB semantic search")
    [void]$sb.AppendLine("                → gemini.service.generateAnalysis(context, facts)")
    [void]$sb.AppendLine("                    → Google Gemini API")
    [void]$sb.AppendLine("            → Response: Markdown text")
    [void]$sb.AppendLine("        → AnalystCard render")
    [void]$sb.AppendLine("            → flutter_markdown + custom StyleSheet")
    [void]$sb.AppendLine("            → stagger animations")
    [void]$sb.AppendLine("``````")
    [void]$sb.AppendLine()
    
    return $sb.ToString()
}

function Build-ArchitectureNotes {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine("## NOTE ARCHITETTURALI")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**Design Patterns**")
    [void]$sb.AppendLine("- FE: StatefulWidget per state management locale")
    [void]$sb.AppendLine("- BE: Service Layer pattern (domain ← services ← API)")
    [void]$sb.AppendLine("- Cache: Write-through con TTL (3600s)")
    [void]$sb.AppendLine("- RAG: Retrieval-Augmented Generation con ChromaDB")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**Librerie Chiave**")
    [void]$sb.AppendLine("- FE: http, geolocator, flutter_markdown, fl_chart, weather_icons")
    [void]$sb.AppendLine("- BE: express, node-cache, axios, @google/generative-ai, chromadb")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**Performance**")
    [void]$sb.AppendLine("- Cache TTL: 3600s (1h)")
    [void]$sb.AppendLine("- API timeout: 15s")
    [void]$sb.AppendLine("- Debounce search: 300ms")
    [void]$sb.AppendLine("- Vector DB: cosine similarity, topK=5")
    [void]$sb.AppendLine()
    
    [void]$sb.AppendLine("**Error Handling**")
    [void]$sb.AppendLine("- FE: try-catch con fallback a cache + StaleDataDialog")
    [void]$sb.AppendLine("- BE: status codes (500, 503, 404) con error propagation")
    [void]$sb.AppendLine("- Gemini API: rate limit handling automatico")
    [void]$sb.AppendLine()
    
    return $sb.ToString()
}

#endregion

#region ------------------ MAIN EXECUTION ------------------

Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "  AI Context Generator v3.1 (Dynamic)" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

try {
    $OutputEncoding = [System.Text.Encoding]::UTF8
    
    # Rileva percorsi progetto
    $scriptPath = $MyInvocation.MyCommand.Path
    $toolsDir = Split-Path -Parent $scriptPath
    $beProjectDir = Split-Path -Parent $toolsDir
    $workspaceDir = Split-Path -Parent $beProjectDir
    
    $feProjectPath = Join-Path $workspaceDir "pesca_app"
    $beProjectPath = $beProjectDir
    
    if (-not (Test-Path $feProjectPath) -or -not (Test-Path $beProjectPath)) {
        throw "Impossibile trovare progetti in: $workspaceDir"
    }
    
    Write-Host "Workspace: $workspaceDir" -ForegroundColor Gray
    Write-Host ""
    
    # Scansione dinamica + merge KB
    Write-Host "[1/5] Scansione Frontend (Flutter)..." -ForegroundColor White
    $feLibPath = Join-Path $feProjectPath "lib"
    $feFiles = Scan-ProjectFiles -BasePath $feLibPath -ProjectType "Flutter" `
        -KnowledgeBase $frontendKB `
        -ExcludeFolders @(".dart_tool", "build", "android", "ios")
    Write-Host "      → Trovati $($feFiles.Count) file Dart" -ForegroundColor Gray
    
    Write-Host "[2/5] Scansione Backend (Node.js)..." -ForegroundColor White
    $beFiles = Scan-ProjectFiles -BasePath $beProjectPath -ProjectType "Node" `
        -KnowledgeBase $backendKB `
        -ExcludeFolders @("node_modules", "pesca_app", "public")
    Write-Host "      → Trovati $($beFiles.Count) file JS" -ForegroundColor Gray
    
    # Genera sezioni
    Write-Host "[3/5] Generazione sezioni AI-style..." -ForegroundColor White
    $feSection = Build-AIStyleSection -FileMap $feFiles -SectionTitle "Frontend (Flutter): pesca_app/lib/"
    $beSection = Build-AIStyleSection -FileMap $beFiles -SectionTitle "Backend (Node.js): pesca-api/"
    
    Write-Host "[4/5] Generazione diagrammi flussi..." -ForegroundColor White
    $flowSection = Build-DataFlowSection
    $notesSection = Build-ArchitectureNotes
    
    # Assembla documento finale
    Write-Host "[5/5] Assemblaggio file..." -ForegroundColor White
    $finalDoc = New-Object System.Text.StringBuilder
    [void]$finalDoc.AppendLine("# METEO PESCA - CONTESTO ARCHITETTURALE PER AI")
    [void]$finalDoc.AppendLine("Generato: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$finalDoc.AppendLine("=" * 80)
    [void]$finalDoc.AppendLine()
    
    [void]$finalDoc.AppendLine("## PANORAMICA PROGETTO")
    [void]$finalDoc.AppendLine()
    [void]$finalDoc.AppendLine("**Stack**: Flutter (FE) + Node.js/Express (BE) + Gemini (AI) + ChromaDB")
    [void]$finalDoc.AppendLine("**Dominio**: App meteo pesca sportiva con AI insights (RAG)")
    [void]$finalDoc.AppendLine("**Features**:")
    [void]$finalDoc.AppendLine("- Previsioni meteo-marine orarie (temp, vento, onde, correnti)")
    [void]$finalDoc.AppendLine("- Calcolo pescaScore algoritmico (0-100)")
    [void]$finalDoc.AppendLine("- Finestre di pesca ottimali (2h blocks)")
    [void]$finalDoc.AppendLine("- Analisi AI contestuale via RAG")
    [void]$finalDoc.AppendLine()
    [void]$finalDoc.AppendLine("=" * 80)
    [void]$finalDoc.AppendLine()
    
    [void]$finalDoc.Append($feSection)
    [void]$finalDoc.AppendLine("=" * 80)
    [void]$finalDoc.AppendLine()
    
    [void]$finalDoc.Append($beSection)
    [void]$finalDoc.AppendLine("=" * 80)
    [void]$finalDoc.AppendLine()
    
    [void]$finalDoc.Append($flowSection)
    [void]$finalDoc.AppendLine("=" * 80)
    [void]$finalDoc.AppendLine()
    
    [void]$finalDoc.Append($notesSection)
    
    # Scrivi su Desktop
    $desktopPath = [Environment]::GetFolderPath("Desktop")
    $outputFile = Join-Path $desktopPath "meteo-pesca-ai-context.txt"
    
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($outputFile, $finalDoc.ToString(), $utf8NoBom)
    
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host "  COMPLETATO!" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "File: $outputFile" -ForegroundColor Yellow
    Write-Host "Size: $([math]::Round((Get-Item $outputFile).Length / 1KB, 2)) KB" -ForegroundColor Gray
    Write-Host "Frontend files: $($feFiles.Count)" -ForegroundColor Gray
    Write-Host "Backend files: $($beFiles.Count)" -ForegroundColor Gray
    Write-Host ""
    
} catch {
    Write-Host ""
    Write-Host "!!! ERRORE !!!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
}

#endregion