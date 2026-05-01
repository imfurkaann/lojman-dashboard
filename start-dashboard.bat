@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - BASLATILIYOR
echo ===============================================
echo.

REM -----------------------------------------------
REM 1. Docker Desktop kontrol
REM -----------------------------------------------
echo [1/6] Docker kontrol ediliyor...

set "DOCKER_PATH=C:\Program Files\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_PATH%" set "DOCKER_PATH=C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe"
if not exist "%DOCKER_PATH%" (
    echo [HATA] Docker Desktop bulunamadi!
    echo       Indir: https://www.docker.com/products/docker-desktop
    pause & exit /b 1
)

tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>nul | find /I "Docker Desktop.exe" >nul
if errorlevel 1 (
    echo [*] Docker Desktop baslatiliyor, lutfen bekleyin...
    start "" "%DOCKER_PATH%"
    set "waited=0"
    :wait_docker
    timeout /t 3 /nobreak >nul
    docker info >nul 2>&1
    if not errorlevel 1 goto docker_ok
    set /a waited+=3
    if !waited! lss 90 goto wait_docker
    echo [HATA] Docker 90 saniyede hazir olmadi. Manuel olarak baslatip tekrar deneyin.
    pause & exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [HATA] Docker calisiyor gorunuyor ama yanit vermiyor.
    echo       Docker Desktop'i yeniden baslatip tekrar deneyin.
    pause & exit /b 1
)

:docker_ok
echo [OK] Docker hazir.

REM -----------------------------------------------
REM 2. Mevcut container'i durdur
REM -----------------------------------------------
echo [2/6] Mevcut container durduruluyor...
cd /d "%~dp0"

docker compose down --remove-orphans >nul 2>&1
timeout /t 2 /nobreak >nul
echo [OK] Container temizlendi.

REM -----------------------------------------------
REM 3. Port 3000 temizle
REM -----------------------------------------------
echo [3/6] Port 3000 kontrol ediliyor...
set "port_busy=0"

for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr /R " *:3000 "') do (
    set "port_busy=1"
    echo [*] Port 3000 PID %%a tarafindan kullaniliyor, kapatiliyor...
    taskkill /PID %%a /F /T >nul 2>&1
)

if "!port_busy!"=="1" (
    timeout /t 2 /nobreak >nul
    REM Hala dolu mu?
    netstat -ano 2>nul | findstr /R " *:3000 " >nul
    if not errorlevel 1 (
        echo [HATA] Port 3000 hala dolu, devam edilemiyor.
        pause & exit /b 1
    )
)
echo [OK] Port 3000 bos.

REM -----------------------------------------------
REM 4. docker-compose.yml kontrol
REM -----------------------------------------------
echo [4/6] docker-compose.yml dogrulaniyor...
docker compose config >nul 2>&1
if errorlevel 1 (
    echo [HATA] docker-compose.yml gecersiz veya bulunamadi!
    pause & exit /b 1
)
echo [OK] docker-compose.yml gecerli.

REM -----------------------------------------------
REM 5. Yerel IP adresini tespit et
REM -----------------------------------------------
echo [5/6] Yerel IP adresi aliniyor...
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /R /C:"IPv4 Adresi" /C:"IPv4 Address"') do (
    set "raw=%%a"
    REM Bosluk temizle
    for /f "tokens=1" %%b in ("!raw!") do (
        REM 192.168 veya 10. ile baslayan ilk adaptoru al
        echo %%b | findstr /R "^192\.168\. ^10\. ^172\." >nul 2>&1
        if not errorlevel 1 (
            if "!LOCAL_IP!"=="" set "LOCAL_IP=%%b"
        )
    )
)

if "!LOCAL_IP!"=="" (
    echo [UYARI] Yerel IP tespit edilemedi. Agda gorulmeyebilir.
    set "LOCAL_IP=<IP_ALINAMADI>"
) else (
    echo [OK] Yerel IP: !LOCAL_IP!
)

REM -----------------------------------------------
REM 6. Container'i baslat (build YOK)
REM -----------------------------------------------
echo [6/6] Container baslatiliyor...
docker compose up -d
if errorlevel 1 (
    echo [HATA] Container baslatilirken hata olustu. Loglar:
    docker compose logs --tail 40
    pause & exit /b 1
)

REM -----------------------------------------------
REM Uygulamanin ayaga kalkmasini bekle
REM -----------------------------------------------
echo.
echo [*] Uygulama bekleniyor (max 120 sn)...
set "waited=0"

:wait_app
timeout /t 2 /nobreak >nul
powershell -NoProfile -Command ^
  "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://localhost:3000/' -TimeoutSec 3; exit ($r.StatusCode -lt 200) } catch { exit 1 }" >nul 2>&1

if not errorlevel 1 goto app_ok

set /a waited+=2
if !waited! equ 20 echo [*] Bekleniyor... (!waited!/120 sn)
if !waited! equ 40 echo [*] Bekleniyor... (!waited!/120 sn)
if !waited! equ 60 echo [*] Bekleniyor... (!waited!/120 sn)
if !waited! equ 90 echo [*] Bekleniyor... (!waited!/120 sn)
if !waited! lss 120 goto wait_app

echo [HATA] 120 saniyede uygulama ayaga kalkmadi.
echo [*] Son container loglari:
docker compose logs --tail 50
pause & exit /b 1

:app_ok
echo.
echo ===============================================
echo   LOJMAN DASHBOARD CALISIYOR
echo ===============================================
echo.
echo   Bilgisayardan : http://localhost:3000
echo   Telefondan    : http://!LOCAL_IP!:3000
echo.
echo   (Telefon ve bilgisayar ayni Wi-Fi'da olmali)
echo.
echo ===============================================
echo.
timeout /t 1 /nobreak >nul
start "" "http://localhost:3000"
exit /b 0