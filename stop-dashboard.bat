@echo off
REM Lojman Dashboard - Durdur Scripti
REM Hayata kalan docker compose servicelerini ve containerleri kapattır

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - DURDURLUYOR
echo ===============================================
echo.

REM Mevcut dizine git
cd /d "%~dp0"

echo [*] Docker containers durdurulüyor...
docker compose down

echo.
if %ERRORLEVEL% equ 0 (
    echo ===============================================
    echo [OK] LOJMAN DASHBOARD DURDURULDU
    echo ===============================================
) else (
    echo ===============================================
    echo [HATA] Durdurma sırasında bir sorun oluştu
    echo ===============================================
)

echo.
pause
