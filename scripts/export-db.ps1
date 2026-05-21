<#
Export lojman.db from the project in whichever form it currently exists:
- If host './data/lojman.db' exists (bind-mount), copy it.
- Else if container `lojman-dashboard` exists, try `docker cp` from /data/lojman.db.
- Else if Docker volume `lojman-db-volume` exists, export its contents via a temporary container.

Creates ./backup/lojman-db.tar.gz
#>
param()

$projRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projRoot

New-Item -ItemType Directory -Force -Path .\backup | Out-Null

if (Test-Path .\data\lojman.db) {
    Write-Host "Found ./data/lojman.db — archiving..."
    Compress-Archive -Path .\data\lojman.db -DestinationPath .\backup\lojman-db.zip -Force
    Write-Host "Exported to backup\lojman-db.zip"
    exit 0
}

$containerId = (docker ps -a --filter "name=lojman-dashboard" -q) 2>$null
if ($containerId) {
    Write-Host "Container lojman-dashboard found — trying docker cp..."
    New-Item -ItemType Directory -Force -Path .\tempdata | Out-Null
    docker cp "$containerId:/data/lojman.db" .\tempdata\lojman.db 2>$null
    if (Test-Path .\tempdata\lojman.db) {
        Compress-Archive -Path .\tempdata\lojman.db -DestinationPath .\backup\lojman-db.zip -Force
        Remove-Item -Recurse -Force .\tempdata
        Write-Host "Exported to backup\lojman-db.zip"
        exit 0
    }
}

# Fallback: check for named volume lojman-db-volume
$volumes = docker volume ls --format '{{.Name}}' 2>$null
if ($volumes -match 'lojman-db-volume') {
    Write-Host "Docker volume lojman-db-volume found — exporting via temporary container..."
    docker run --rm -v lojman-db-volume:/volume -v ${PWD}:/backup alpine sh -c "cd /volume && tar czf /backup/lojman-db.tar.gz ." 2>$null
    if (Test-Path .\lojman-db.tar.gz) {
        Move-Item .\lojman-db.tar.gz .\backup\lojman-db.tar.gz -Force
        Write-Host "Exported to backup\lojman-db.tar.gz"
        exit 0
    }
}

Write-Host "No DB found in ./data, container, or named volume. Check your setup." -ForegroundColor Yellow
exit 1
