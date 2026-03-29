@echo off
REM Lojman Dashboard - Stop Script
REM Stops Docker containers

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - STOPPING
echo ===============================================
echo.

cd /d "%~dp0"

echo [*] Stopping Docker containers...
docker compose down

echo.
if %ERRORLEVEL% equ 0 (
    echo ===============================================
    echo [OK] LOJMAN DASHBOARD STOPPED
    echo ===============================================
) else (
    echo ===============================================
    echo [ERROR] An error occurred while stopping
    echo ===============================================
)

echo.
pause
exit /b 0
