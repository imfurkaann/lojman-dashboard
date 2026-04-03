@echo off
REM Lojman Dashboard - Start Script
REM Automatically starts Docker and application

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - STARTING
echo ===============================================
echo.

set "APP_PORT=%PORT%"
if "%APP_PORT%"=="" set "APP_PORT=3000"
set "REQUESTED_PORT=%APP_PORT%"

if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    if not exist "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe" (
        echo [ERROR] Docker Desktop not found!
        echo Please download: https://www.docker.com/products/docker-desktop
        echo.
        pause
        exit /b 1
    )
)

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>NUL | find /I /N "Docker Desktop.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [*] Starting Docker Desktop...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    
    echo [*] Please wait...
    timeout /t 3 /nobreak >NUL
    
    for /L %%i in (1,1,60) do (
        docker ps >NUL 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [OK] Docker ready!
            goto docker_ready
        )
        timeout /t 1 /nobreak >NUL
    )
    
    echo [ERROR] Docker startup failed. Please start it manually.
    pause
    exit /b 1
) else (
    echo [OK] Docker is already running.
)

:docker_ready
for /L %%p in (%APP_PORT%,1,3100) do (
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %%p -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }"
    if !ERRORLEVEL! equ 0 (
        set "APP_PORT=%%p"
        goto port_ready
    )
)

echo [ERROR] 3000-3100 araliginda bos port bulunamadi.
pause
exit /b 1

:port_ready
if not "!APP_PORT!"=="!REQUESTED_PORT!" (
    echo [*] 3000 portu dolu oldugu icin !APP_PORT! portu kullanilacak.
)

echo.
echo [*] Starting application...
echo.

cd /d "%~dp0"
set "PORT=!APP_PORT!"
docker compose up -d
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] docker compose up failed.
    echo [INFO] Last container logs:
    docker compose logs --tail 80
    pause
    exit /b 1
)

echo [*] Waiting for application to start...
set "max_wait=30"
for /L %%i in (1,1,%max_wait%) do (
    timeout /t 1 /nobreak >NUL
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:!APP_PORT!/dashboard' -TimeoutSec 2; if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500) { exit 0 } else { exit 1 } } catch { exit 1 }"
    if !ERRORLEVEL! equ 0 (
        echo [OK] Application ready!
        goto app_ready
    )
)

echo [ERROR] Application did not become ready within %max_wait% seconds.
echo [INFO] Last container logs:
docker compose logs --tail 80
pause
exit /b 1

:app_ready
echo.
echo ===============================================
echo [OK] LOJMAN DASHBOARD IS RUNNING
echo ===============================================
echo.
echo Address: http://localhost:!APP_PORT!
echo.

start "" "http://localhost:!APP_PORT!"
timeout /t 2 /nobreak >NUL
exit /b 0
