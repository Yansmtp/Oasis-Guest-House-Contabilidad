param(
    [Parameter(Mandatory = $true)]
    [string]$BackupDir,
    [switch]$SkipFiles
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

function Resolve-PgRestore([string]$EnvPath) {
    $envRestore = Get-EnvValue $EnvPath "PG_RESTORE_PATH"
    if ($envRestore -and (Test-Path $envRestore)) { return $envRestore }

    # If PG_DUMP_PATH is configured, try pg_restore in the same folder.
    $envDump = Get-EnvValue $EnvPath "PG_DUMP_PATH"
    if ($envDump) {
        $candidateFromDump = Join-Path (Split-Path -Parent $envDump) "pg_restore.exe"
        if (Test-Path $candidateFromDump) { return $candidateFromDump }
    }

    $cmd = Get-Command pg_restore -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    $candidates = @(
        "C:\Program Files\PostgreSQL\18\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\16\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\15\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\14\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\13\bin\pg_restore.exe",
        "C:\Program Files\PostgreSQL\12\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\18\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\17\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\16\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\15\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\14\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\13\bin\pg_restore.exe",
        "C:\Program Files (x86)\PostgreSQL\12\bin\pg_restore.exe"
    )
    $path = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $path) {
        throw "pg_restore no esta disponible en PATH. Instala PostgreSQL, define PG_RESTORE_PATH en backend/.env o agrega pg_restore al PATH."
    }
    return $path
}

function Copy-BackupFolder([string]$TempRoot, [string]$FolderName, [string]$TargetPath) {
    $src = Get-ChildItem -Path $TempRoot -Directory -Recurse | Where-Object { $_.Name -eq $FolderName } | Select-Object -First 1
    if (-not $src) { return }
    if (Test-Path $TargetPath) {
        Remove-Item -Path $TargetPath -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $TargetPath) | Out-Null
    Copy-Item -Path $src.FullName -Destination $TargetPath -Recurse -Force
}

$root = Split-Path -Parent $PSScriptRoot
$resolvedBackupDir = if ([System.IO.Path]::IsPathRooted($BackupDir)) { $BackupDir } else { Join-Path $root $BackupDir }
if (-not (Test-Path $resolvedBackupDir)) {
    throw "No existe la carpeta de respaldo: $resolvedBackupDir"
}

$dbDump = Join-Path $resolvedBackupDir "db.backup"
if (-not (Test-Path $dbDump)) {
    throw "No se encontro db.backup en: $resolvedBackupDir"
}

$envPath = Join-Path $root "backend\.env"
$dbUrl = Get-EnvValue $envPath "DATABASE_URL"
$db = Parse-DatabaseUrl $dbUrl
$pgRestorePath = Resolve-PgRestore $envPath

$env:PGPASSWORD = $db.Password
& $pgRestorePath --clean --if-exists --no-owner --no-privileges --host "$($db.Host)" --port "$($db.Port)" --username "$($db.User)" --dbname "$($db.Db)" "$dbDump"
if ($LASTEXITCODE -ne 0) {
    throw "pg_restore devolvio error (codigo $LASTEXITCODE). Verifica version de PostgreSQL, credenciales y permisos."
}

if (-not $SkipFiles) {
    $filesZip = Join-Path $resolvedBackupDir "files.zip"
    if (Test-Path $filesZip) {
        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("inv-restore-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null
        try {
            Expand-Archive -Path $filesZip -DestinationPath $tmp -Force
            Copy-BackupFolder -TempRoot $tmp -FolderName "uploads" -TargetPath (Join-Path $root "backend\uploads")
            Copy-BackupFolder -TempRoot $tmp -FolderName "config" -TargetPath (Join-Path $root "backend\config")
        } finally {
            if (Test-Path $tmp) { Remove-Item -Path $tmp -Recurse -Force }
        }
    }
}

Write-Host "Restauracion completada desde: $resolvedBackupDir"
