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
    timeout /t 3 /nobreak
    
    for /L %%%%i in (1,1,60) do (
        docker ps >NUL 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [OK] Docker ready!
            goto docker_ready
        )
        timeout /t 1 /nobreak
    )
    
    echo [ERROR] Docker startup failed. Please start it manually.
    pause
    exit /b 1
) else (
    echo [OK] Docker is already running.
)

:docker_ready
echo.
echo [*] Starting application...
echo.

cd /d "%~dp0"
docker compose up -d

echo [*] Waiting for application to start...
set "max_wait=30"
for /L %%%%i in (1,1,%max_wait%) do (
    timeout /t 1 /nobreak
    curl -s http://localhost:3000 >NUL 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] Application ready!
        goto app_ready
    )
)

:app_ready
echo.
echo ===============================================
echo [OK] LOJMAN DASHBOARD IS RUNNING
echo ===============================================
echo.
echo Address: http://localhost:3000
echo.

start "" "http://localhost:3000"
timeout /t 2 /nobreak
exit /b 0
