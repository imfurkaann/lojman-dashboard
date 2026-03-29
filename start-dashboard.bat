@echo off
REM Lojman Dashboard - Başlat Scripti
REM Non-teknik kullanıcılar için - Docker Desktop'ı başlatır ve uygulamayı çalıştırır

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - BAŞLATILIYOR
echo ===============================================
echo.

REM Docker Desktop'ın yüklü olup olmadığını kontrol et
if not exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
    if not exist "C:\Program Files (x86)\Docker\Docker\Docker Desktop.exe" (
        echo.
        echo [HATA] Docker Desktop sistemde yüklü değil!
        echo Lütfen Docker Desktop'ı yükleyin: https://www.docker.com/products/docker-desktop
        echo.
        pause
        exit /b 1
    )
)

REM Docker Desktop açık mı kontrol et, açık değilse aç
tasklist /FI "IMAGENAME eq Docker Desktop.exe" 2>NUL | find /I /N "Docker Desktop.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [*] Docker Desktop başlatılıyor...
    start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    
    REM Docker'ın başlaması için bekleme (max 60 saniye)
    echo [*] Docker başlatılıyor, lütfen bekleyiniz...
    timeout /t 3 /nobreak
    
    for /L %%i in (1,1,60) do (
        docker ps >NUL 2>&1
        if !ERRORLEVEL! equ 0 (
            echo [OK] Docker hazır!
            goto docker_ready
        )
        timeout /t 1 /nobreak
    )
    
    echo [HATA] Docker başlanamadı. Lütfen Docker Desktop'ı manuel olarak açın.
    pause
    exit /b 1
) else (
    echo [OK] Docker Desktop zaten çalışıyor.
)

:docker_ready
echo.
echo [*] Uygulama başlatılıyor...
echo.

REM Mevcut dizine git
cd /d "%~dp0"

REM Docker Compose ile sistemi başlat (background'da)
docker compose up -d

REM Uygulamanın başlaması için bekle (max 30 saniye)
echo [*] Uygulama başlatılıyor, lütfen bekleyiniz...
set "max_wait=30"
for /L %%i in (1,1,%max_wait%) do (
    timeout /t 1 /nobreak
    curl -s http://localhost:3000 >NUL 2>&1
    if !ERRORLEVEL! equ 0 (
        echo [OK] Uygulama hazır!
        goto app_ready
    )
)

echo.
echo [!] Uygulamanın başlaması biraz zaman alabilir, lütfen bekleyiniz...

:app_ready
echo.
echo ===============================================
echo [OK] LOJMAN DASHBOARD ÇALIŞIYOR!
echo ===============================================
echo.
echo Adres: http://localhost:3000
echo.
echo Tarayıcı açılıyor...
echo.

REM Tarayıcıda uygulamayı aç
start "" "http://localhost:3000"

REM Kapatma talimatları
echo.
echo -----------------------------------------------
echo Uygulamayı kapatmak için:
echo 1. stop-dashboard.bat dosyasını çalıştırın
echo 2. Ya da Windows Komut İsteminde şu yazın:
echo    docker compose down
echo -----------------------------------------------
echo.

pause
