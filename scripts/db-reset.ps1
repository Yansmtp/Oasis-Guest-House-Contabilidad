param(
    [switch]$Force,
    [switch]$WithBackup
)

$ErrorActionPreference = "Stop"

if (-not $Force) {
    throw "Este comando borra todos los datos. Usa -Force para continuar."
}

$root = Split-Path -Parent $PSScriptRoot

if ($WithBackup) {
    & (Join-Path $root "scripts\db-backup.ps1")
}

Push-Location (Join-Path $root "backend")
try {
    npx prisma migrate reset --force
} finally {
    Pop-Location
}

Write-Host "Base de datos reiniciada."
