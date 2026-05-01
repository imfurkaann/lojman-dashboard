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
REM Port 3000 kontrol et
for /L %%p in (3000,1,3000) do (
    powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort %%p -State Listen -ErrorAction SilentlyContinue) { exit 1 } else { exit 0 }" 2>NUL
    if !ERRORLEVEL! equ 1 (
        echo [*] Port 3000 kullaniliyorsa kil...
        for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3000') do (
            taskkill /PID %%a /F >nul 2>&1
        )
        timeout /t 2 >nul
    )
)

:port_ready
echo [*] Port 3000 kullanilacak

echo.
echo [*] Uygulama baslatiliyor...
echo.

cd /d "%~dp0"
set "PORT=3000"
docker compose up -d 
if not "%ERRORLEVEL%"=="0" (
    echo [ERROR] docker compose başarısız.
    docker compose logs --tail 50
    pause
    exit /b 1
)

echo [*] Uygulama baslandığı kontrol ediliyor (max 120 saniye)...
set "max_wait=120"
for /L %%i in (1,1,%max_wait%) do (
    timeout /t 1 /nobreak >NUL
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 3; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }" 2>NUL
    if !ERRORLEVEL! equ 0 (
        echo [OK] Uygulama hazir!
        goto app_ready
    )
    if %%i equ 10 echo [*] Bekleniyor... (%%i/!max_wait!)
    if %%i equ 30 echo [*] Bekleniyor... (%%i/!max_wait!)
    if %%i equ 60 echo [*] Bekleniyor... (%%i/!max_wait!)
    if %%i equ 90 echo [*] Bekleniyor... (%%i/!max_wait!)
)

echo [ERROR] Uygulama baslamadi (120 saniye timeout).
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

start "" "http://localhost:3000"
timeout /t 2 /nobreak >NUL
exit /b 0