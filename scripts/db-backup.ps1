param(
    [string]$OutputDir = "backups"
)

$ErrorActionPreference = "Stop"

function Get-EnvValue([string]$Path, [string]$Key) {
    if (-not (Test-Path $Path)) { throw "No se encontro el archivo: $Path" }
    $lines = Get-Content $Path
    foreach ($line in $lines) {
        if ($line.Trim().StartsWith("#")) { continue }
        if ($line -match ('^\s*' + $Key + '\s*=\s*"?([^"]*?)"?\s*$')) {
            return $Matches[1]
        }
    }
    return $null
}

function Parse-DatabaseUrl([string]$Url) {
    if (-not $Url) { throw "DATABASE_URL no esta definido" }
    if ($Url -notmatch "^postgresql:\/\/(.+?):(.+?)@(.+?):(\d+)\/(.+)$") {
        throw "DATABASE_URL no tiene el formato esperado (postgresql://user:pass@host:port/db)"
    }
    return @{
        User = $Matches[1]
        Password = $Matches[2]
        Host = $Matches[3]
        Port = $Matches[4]
        Db = $Matches[5]
    }
}

$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root "backend\.env"
$dbUrl = Get-EnvValue $envPath "DATABASE_URL"
$db = Parse-DatabaseUrl $dbUrl

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupBase = if ([System.IO.Path]::IsPathRooted($OutputDir)) { $OutputDir } else { Join-Path $root $OutputDir }
$backupDir = Join-Path $backupBase $timestamp

$dbDump = Join-Path $backupDir "db.backup"
$uploadsPath = Join-Path $root "backend\uploads"
$configPath = Join-Path $root "backend\config"
$archivePath = Join-Path $backupDir "files.zip"

$pgDumpPath = $null
$envPgDumpPath = Get-EnvValue $envPath "PG_DUMP_PATH"
if ($envPgDumpPath -and (Test-Path $envPgDumpPath)) {
    $pgDumpPath = $envPgDumpPath
} else {
    $pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue)
    if ($pgDump) {
        $pgDumpPath = $pgDump.Source
    } else {
        $candidates = @(
            "C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe",
            "C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe",
            "C:\\Program Files\\PostgreSQL\\15\\bin\\pg_dump.exe",
            "C:\\Program Files\\PostgreSQL\\14\\bin\\pg_dump.exe",
            "C:\\Program Files\\PostgreSQL\\13\\bin\\pg_dump.exe",
            "C:\\Program Files\\PostgreSQL\\12\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\17\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\16\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\15\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\14\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\13\\bin\\pg_dump.exe",
            "C:\\Program Files (x86)\\PostgreSQL\\12\\bin\\pg_dump.exe"
        )
        $pgDumpPath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    }
}

if (-not $pgDumpPath) {
    throw "pg_dump no esta disponible en PATH. Instala PostgreSQL, define PG_DUMP_PATH en backend/.env o agrega pg_dump al PATH."
}

New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$env:PGPASSWORD = $db.Password
& $pgDumpPath --format=c --file "$dbDump" --host "$($db.Host)" --port "$($db.Port)" --username "$($db.User)" --dbname "$($db.Db)"
if ($LASTEXITCODE -ne 0) {
    throw "pg_dump devolvio error (codigo $LASTEXITCODE). Verifica credenciales DATABASE_URL y permisos del usuario."
}
if (-not (Test-Path $dbDump)) {
    throw "No se genero el archivo db.backup. El respaldo fallo."
}

$items = @()
if (Test-Path $uploadsPath) { $items += $uploadsPath }
if (Test-Path $configPath) { $items += $configPath }

if ($items.Count -gt 0) {
    Compress-Archive -Path $items -DestinationPath $archivePath -Force
}

Write-Host "Backup completado en: $backupDir"
