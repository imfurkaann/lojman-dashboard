<#
Import backup archives created by export scripts into this project.
Behavior:
- If this project uses host bind-mounts (./data, ./public/uploads) the archives are extracted to those folders.
- Otherwise, if a Docker volume `lojman-db-volume` exists or is desired, the DB tar.gz is imported into that volume.

Usage: run from project root where `docker-compose.yml` is located.
    .\scripts\import-backup.ps1
#>
param()

$projRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projRoot

$backupDir = Join-Path $projRoot 'backup'
if (-not (Test-Path $backupDir)) {
    Write-Host "Backup directory not found: $backupDir" -ForegroundColor Red
    exit 1
}

$compose = Get-Content docker-compose.yml -Raw -ErrorAction SilentlyContinue
$useHostData = Test-Path .\data -or ($compose -match '\./data')
$useHostUploads = Test-Path .\public\uploads -or ($compose -match '\./public/uploads')

# -- Import DB
if (Test-Path (Join-Path $backupDir 'lojman-db.zip')) {
    Write-Host "Restoring DB from lojman-db.zip to host ./data..."
    New-Item -ItemType Directory -Force -Path .\data | Out-Null
    Expand-Archive -Path (Join-Path $backupDir 'lojman-db.zip') -DestinationPath .\data -Force
    Write-Host "DB restored to ./data"
} elseif (Test-Path (Join-Path $backupDir 'lojman-db.tar.gz')) {
    if ($useHostData) {
        Write-Host "Extracting lojman-db.tar.gz to host ./data..."
        New-Item -ItemType Directory -Force -Path .\data | Out-Null
        tar -xzf (Join-Path $backupDir 'lojman-db.tar.gz') -C .\data
        Write-Host "DB extracted to ./data"
    } else {
        Write-Host "Importing lojman-db.tar.gz into Docker volume 'lojman-db-volume'..."
        docker volume create lojman-db-volume | Out-Null
        docker run --rm -v lojman-db-volume:/volume -v ${PWD}\backup:/backup alpine sh -c "cd /volume && tar xzf /backup/lojman-db.tar.gz"
        Write-Host "DB imported into Docker volume lojman-db-volume"
    }
} else {
    Write-Host "No DB archive found in backup folder." -ForegroundColor Yellow
}

# -- Import uploads
if (Test-Path (Join-Path $backupDir 'uploads.zip')) {
    if ($useHostUploads) {
        Write-Host "Restoring uploads to ./public/uploads..."
        New-Item -ItemType Directory -Force -Path .\public\uploads | Out-Null
        Expand-Archive -Path (Join-Path $backupDir 'uploads.zip') -DestinationPath .\public\uploads -Force
        Write-Host "Uploads restored to ./public/uploads"
    } else {
        Write-Host "Host uploads path not detected; extracting uploads.zip to ./public/uploads anyway..."
        New-Item -ItemType Directory -Force -Path .\public\uploads | Out-Null
        Expand-Archive -Path (Join-Path $backupDir 'uploads.zip') -DestinationPath .\public\uploads -Force
        Write-Host "Uploads restored to ./public/uploads"
    }
} else {
    Write-Host "No uploads archive found in backup folder." -ForegroundColor Yellow
}

Write-Host "Import finished. You can now run: docker compose up -d --build" -ForegroundColor Green
