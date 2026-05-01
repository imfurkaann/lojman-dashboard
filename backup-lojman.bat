@echo off
REM Lojman Dashboard Backup Script
REM Hem database hem de görselleri aynı klasöre yedekler

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - BACKUP
echo ===============================================
echo.

REM Tarih ve saat ile klasör adı oluştur (YYYY-MM-DD_HH-MM-SS)
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a-%%b)
set "BACKUP_DIR=backup_%mydate%_%mytime%"

echo [*] Backup klasörü oluşturuluyor: %BACKUP_DIR%
mkdir "%BACKUP_DIR%"

if not exist "%BACKUP_DIR%" (
    echo [ERROR] Klasör oluşturulamadı!
    pause
    exit /b 1
)

echo.
echo [*] Database yedekleniyor...
docker compose exec -T app cat /data/lojman.db > "%BACKUP_DIR%\lojman.db" 2>NUL
if %errorlevel% equ 0 (
    echo [OK] Database yedeklendi: %BACKUP_DIR%\lojman.db
) else (
    echo [WARNING] Database yedeklenemedi - container çalışıyor mu?
)

echo.
echo [*] Görseller yedekleniyor...
docker compose cp lojman-dashboard:/app/public/uploads "%BACKUP_DIR%\uploads" 2>NUL
if %errorlevel% equ 0 (
    echo [OK] Görseller yedeklendi: %BACKUP_DIR%\uploads
) else (
    echo [WARNING] Görseller yedeklenemedi
)

echo.
echo [*] WhatsApp verisi yedekleniyor...
docker compose cp lojman-dashboard:/data/whatsapp-auth "%BACKUP_DIR%\whatsapp-auth" 2>NUL
if %errorlevel% equ 0 (
    echo [OK] WhatsApp verisi yedeklendi: %BACKUP_DIR%\whatsapp-auth
) else (
    echo [WARNING] WhatsApp verisi yedeklenemedi
)

echo.
echo ===============================================
echo [OK] BACKUP TAMAMLANDI
echo ===============================================
echo.
echo Klasör: %CD%\%BACKUP_DIR%
echo.
echo İçerik:
dir "%BACKUP_DIR%" /B
echo.
pause
