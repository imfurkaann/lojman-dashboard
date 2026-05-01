@echo off
REM Lojman Dashboard - Optimize Edilmis Start Script
setlocal enabledelayedexpansion

:: ===============================================
:: 1. YÖNETİCİ İZNİ KONTROLÜ
:: ===============================================
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [HATA] Lutfen bu dosyaya sag tiklayip "Yonetici Olarak Calistir" deyin.
    pause
    exit /b 1
)

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - BAŞLATILIYOR
echo ===============================================
echo.

:: Değişkenler
set "APP_PORT=3000"
cd /d "%~dp0"

:: ===============================================
:: 2. DOCKER KONTROLÜ
:: ===============================================
where docker >nul 2>&1
if %errorLevel% neq 0 (
    echo [HATA] Docker bulunamadi! Lutfen Docker Desktop'in kurulu oldugundan emin olun.
    pause
    exit /b 1
)

:: Docker Desktop'ın çalışıp çalışmadığını kontrol et
docker ps >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Docker Desktop calismiyor, baslatiliyor...
    
    :: Docker Desktop yolunu otomatik bulmaya çalış
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [HATA] Docker Desktop exe yolu bulunamadi. Lutfen Docker'i manuel acin.
        pause
        exit /b 1
    )

    echo [*] Docker'in hazir olmasi bekleniyor...
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker ps >nul 2>&1
    if %errorLevel% neq 0 goto wait_docker
    echo [OK] Docker hazir!
) else (
    echo [OK] Docker zaten calisiyor.
)

:: ===============================================
:: 3. PORT TEMİZLİĞİ (Port 3000)
:: ===============================================
echo [*] Port %APP_PORT% kontrol ediliyor...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%APP_PORT% ^| findstr LISTENING') do (
    echo [*] Port %APP_PORT% kullanimda (PID: %%a), serbest birakiliyor...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 2 /nobreak >nul
)

:: ===============================================
:: 4. DOCKER COMPOSE BAŞLATMA
:: ===============================================
if not exist "docker-compose.yml" if not exist "docker-compose.yaml" (
    echo [HATA] docker-compose.yml dosyasi bu klasorde bulunamadi!
    pause
    exit /b 1
)

echo [*] Konteynerler ayaga kaldiriliyor...
docker compose up -d --build
if %errorLevel% neq 0 (
    echo [HATA] Docker Compose baslatilamadi.
    docker compose logs --tail 20
    pause
    exit /b 1
)

:: ===============================================
:: 5. UYGULAMA SAĞLIK KONTROLÜ
:: ===============================================
echo [*] Uygulamanin cevap vermesi bekleniyor...
set "max_attempts=30"
set "attempt=1"

:check_app
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:%APP_PORT%' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if %errorLevel% equ 0 (
    echo.
    echo ===============================================
    echo [OK] LOJMAN DASHBOARD BASARIYLA CALISTI
    echo ===============================================
    echo Erisim: http://localhost:%APP_PORT%
    start "" "http://localhost:%APP_PORT%"
    timeout /t 5 >nul
    exit /b 0
)

if %attempt% leq %max_attempts% (
    set /a attempt+=1
    echo [*] Bekleniyor... (%attempt%/%max_attempts%)
    timeout /t 2 /nobreak >nul
    goto check_app
)

echo [HATA] Uygulama zaman aşımına ugradı. Loglar kontrol ediliyor...
docker compose logs --tail 50
pause