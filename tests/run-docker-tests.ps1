$ErrorActionPreference = 'Stop'

Write-Host 'Running integration tests inside Docker app container...'

$containerId = docker compose ps -q app
if (-not $containerId) {
  throw 'App container is not running. Start it first with: docker compose up -d --build'
}

docker compose exec -T app npm test
