<#
Export uploads (public/uploads) from the project:
- If host ./public/uploads exists, archive it.
- Else try docker cp from running container lojman-dashboard:/app/public/uploads
- Else try exporting from a volume (if uploads were stored in a volume)

Creates ./backup/uploads.tar.gz
#>
param()

$projRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $projRoot

New-Item -ItemType Directory -Force -Path .\backup | Out-Null

if (Test-Path .\public\uploads) {
    Write-Host "Found ./public/uploads — archiving..."
    Compress-Archive -Path .\public\uploads\* -DestinationPath .\backup\uploads.zip -Force
    Write-Host "Exported to backup\uploads.zip"
    exit 0
}

$containerId = (docker ps -a --filter "name=lojman-dashboard" -q) 2>$null
if ($containerId) {
    Write-Host "Container lojman-dashboard found — trying docker cp uploads..."
    New-Item -ItemType Directory -Force -Path .\tempuploads | Out-Null
    docker cp "$containerId:/app/public/uploads/." .\tempuploads 2>$null
    if ((Get-ChildItem -Recurse .\tempuploads | Measure-Object).Count -gt 0) {
        Compress-Archive -Path .\tempuploads\* -DestinationPath .\backup\uploads.zip -Force
        Remove-Item -Recurse -Force .\tempuploads
        Write-Host "Exported to backup\uploads.zip"
        exit 0
    }
}

Write-Host "No uploads found on host or in container. If uploads were in a Docker volume, export manually." -ForegroundColor Yellow
exit 1
