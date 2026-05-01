@echo off
setlocal enabledelayedexpansion

:: ===============================================
:: 1. OTOMATIK YONETICI YETKISI ALMA
:: ===============================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Yonetici yetkisi aliniyor...
    powershell -Command "Start-Process -FilePath '%0' -Verb RunAs"
    exit /b
)

:: ===============================================
:: 2. DIZIN VE AYARLAR
:: ===============================================
cls
title Lojman Dashboard Starter
cd /d "%~dp0"
echo ===============================================
echo   LOJMAN DASHBOARD - GUVENLI BASLATICI
echo ===============================================
echo.

:: ===============================================
:: 3. DOCKER CALISIYOR MU KONTROL ET
:: ===============================================
echo [*] Docker kontrol ediliyor...
docker ps >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Docker calismiyor. Baslatilmaya calisiliyor...
    
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [HATA] Docker Desktop bulunamadi. Lutfen manuel acin.
        pause
        exit /b 1
    )

    echo [*] Docker'in hazir olmasi bekleniyor...
    :docker_wait
    timeout /t 5 /nobreak >nul
    docker ps >nul 2>&1
    if %errorLevel% neq 0 goto docker_wait
    echo [OK] Docker artik hazir.
)

:: ===============================================
:: 4. PORT 3000 TEMIZLIGI
:: ===============================================
echo [*] Port 3000 kontrol ediliyor...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    echo [!] Port 3000 dolu (PID: %%a). Kapatiliyor...
    taskkill /PID %%a /F >nul 2>&1
)

:: ===============================================
:: 5. DOCKER COMPOSE CALISTIRMA
:: ===============================================
if not exist "docker-compose.yml" if not exist "docker-compose.yaml" (
    echo [HATA] Bu klasorde docker-compose.yml dosyasi yok!
    echo Mevcut konum: %cd%
    pause
    exit /b 1
)

echo [*] Konteynerler ayaga kaldiriliyor (docker compose up)...
docker compose up -d
if %errorLevel% neq 0 (
    echo.
    echo [HATA] Docker baslatilamadi! Hata detaylari yukaridadir.
    echo.
    pause
    exit /b 1
)

:: ===============================================
:: 6. UYGULAMA KONTROL VE ACILIS
:: ===============================================
echo [*] Uygulama hazirlaniyor (10 saniye bekleniyor)...
timeout /t 10 /nobreak >nul

echo [OK] Tarayici aciliyor: http://localhost:3000
start "" "http://localhost:3000"

echo.
echo ===============================================
echo   ISLEM TAMAMLANDI. BU PENCEREYI KAPATABILIRSINIZ.
echo ===============================================
pause