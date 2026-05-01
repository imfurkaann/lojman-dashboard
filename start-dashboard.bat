@echo off
REM Lojman Dashboard - Start Script (Temiz Versiyon)
setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - CALISMAYA HAZIRLANIYOR
echo ===============================================
echo.

REM Docker kontrolü
if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    if not exist "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe" (
        echo [ERROR] Docker Desktop bulunamadi!
        echo Indir: https://www.docker.com/products/docker-desktop
        pause
        exit /b 1
    )
)

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>NUL | find /I /N "Docker Desktop.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [*] Docker Desktop baslatiliyor...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    echo [*] 60 saniye bekleniyor...
    
    for /L %%i in (1,1,60) do (
        docker ps >NUL 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [OK] Docker hazir!
            goto docker_ready
        )
        timeout /t 1 /nobreak >NUL
    )
    
    echo [ERROR] Docker baslatılamadı. Manuel olarak başlatın.
    pause
    exit /b 1
) else (
    echo [OK] Docker zaten çalışıyor.
)

:docker_ready
REM Container zaten çalışıyor mu kontrol et
echo [*] Mevcut container kontrol ediliyor...
docker ps --filter "name=lojman-dashboard" --format "{{.Status}}" >nul 2>&1
if %errorLevel% equ 0 (
    for /f "tokens=*" %%x in ('docker ps --filter "name=lojman-dashboard" --format "{{.Status}}" 2^>nul') do (
        if "%%x" NEQ "" (
            echo [*] Container zaten çalışıyor, durduruluyor...
            docker compose down --remove-orphans >nul 2>&1
            timeout /t 2 >nul
        )
    )
)

REM Port 3000 temizle
echo [*] Port 3000 kontrol ediliyor...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3000') do (
    echo [*] Port 3000'de PID %%a olusturuluyor...
    taskkill /PID %%a /F /T >nul 2>&1
)
timeout /t 2 >nul

:port_ready
echo [*] Port 3000 temizlendi

echo.
echo [*] Uygulama baslatiliyor...
echo.

cd /d "%~dp0"
set "PORT=3000"

REM Docker compose kontrol
docker compose config >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] docker-compose.yml hatali!
    pause
    exit /b 1
)

REM Container'i temiz başlat
echo [*] Container kaldiriliyor...
docker compose down --remove-orphans >nul 2>&1
timeout /t 2 >nul

echo [*] Yeni container baslatiliyor...
docker compose up -d --build
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] docker compose başarısız. Docker daemon'ı kontrol edin.
    echo [*] Docker daemon yeniden başlatılıyor...
    taskkill /IM "Docker Desktop.exe" /F >nul 2>&1
    timeout /t 3 >nul
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    timeout /t 30 >nul
    
    echo [*] Tekrar deniyor...
    docker compose up -d 
    if not "%ERRORLEVEL%"=="0" (
        echo [ERROR] Hala başarısız. Log:
        docker compose logs --tail 30
        pause
        exit /b 1
    )
)

echo [*] Uygulama baslandığı kontrol ediliyor (max 120 saniye)...
set "max_wait=120"
set "wait_count=0"

:wait_loop
set /a wait_count+=1
timeout /t 1 /nobreak >nul

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 3; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1

if %ERRORLEVEL% equ 0 (
    echo [OK] Uygulama hazir!
    goto app_ready
)

if %wait_count% equ 10 echo [*] Bekleniyor... (%wait_count%/%max_wait!)
if %wait_count% equ 30 echo [*] Bekleniyor... (%wait_count%/%max_wait!)
if %wait_count% equ 60 echo [*] Bekleniyor... (%wait_count%/%max_wait!)
if %wait_count% equ 90 echo [*] Bekleniyor... (%wait_count%/%max_wait!)

if %wait_count% lss %max_wait% goto wait_loop

echo [ERROR] Uygulama baslamadi (120 saniye timeout).
echo [*] Son log kayıtları:
docker compose logs --tail 50
pause
exit /b 1

:app_ready
echo.
echo ===============================================
echo [TAMAM] LOJMAN DASHBOARD ÇALIŞIYOR
echo ===============================================
echo.
echo Adres: http://localhost:3000
echo.

timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0