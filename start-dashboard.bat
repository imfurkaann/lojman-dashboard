@echo off
REM Lojman Dashboard - Auto-Elevate Start Script
setlocal enabledelayedexpansion

:: ===============================================
:: 1. OTOMATİK YÖNETİCİ YETKİSİ ALMA
:: ===============================================
:check_Permissions
    net session >nul 2>&1
    if %errorLevel% == 0 (
        goto :admin_confirmed
    ) else (
        echo [*] Yetki yukseltiliyor... Lutfen cikan uyarida 'Evet'e tiklayin.
        powershell -Command "Start-Process -FilePath '%0' -Verb RunAs"
        exit /b
    )

:admin_confirmed
cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - YONETICI MODUNDA CALISIYOR
echo ===============================================
echo.

:: Değişkenler ve Konum
set "APP_PORT=3000"
cd /d "%~dp0"

:: ===============================================
:: 2. DOCKER KONTROLÜ
:: ===============================================
docker ps >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Docker Desktop calismiyor, baslatiliyor...
    
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else if exist "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [HATA] Docker Desktop bulunamadi. Lutfen manuel olarak acin.
        pause
        exit /b 1
    )

    echo [*] Docker'in hazir olmasi bekleniyor (bu biraz surebilir)...
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker ps >nul 2>&1
    if %errorLevel% neq 0 goto :wait_docker
    echo [OK] Docker hazir!
)

:: ===============================================
:: 3. PORT TEMİZLİĞİ
:: ===============================================
echo [*] Port %APP_PORT% kontrol ediliyor...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%APP_PORT% ^| findstr LISTENING') do (
    echo [!] Port %APP_PORT% dolu. PID %%a sonlandiriliyor...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

:: ===============================================
:: 4. UYGULAMAYI BAŞLATMA
:: ===============================================
if not exist "docker-compose.yml" (
    echo [HATA] docker-compose.yml dosyasi bulunamadi!
    echo Bulundugunuz konum: %cd%
    pause
    exit /b 1
)

echo [*] Konteynerler baslatiliyor...
docker compose up -d
if %errorLevel% neq 0 (
    echo [HATA] Baslatma sirasinda bir sorun olustu.
    docker compose logs --tail 20
    pause
    exit /b 1
)

:: ===============================================
:: 5. SAĞLIK KONTROLÜ VE TARAYICI
:: ===============================================
echo [*] Uygulama hazirlaniyor...
timeout /t 5 /nobreak >nul

echo [OK] Uygulama aciliyor: http://localhost:%APP_PORT%
start "" "http://localhost:%APP_PORT%"

echo.
echo ===============================================
echo   HER SEY HAZIR! IYI CALISMALAR.
echo ===============================================
timeout /t 5 >nul
exit /b 0