@echo off
REM Lojman Dashboard - Database Backup Script
REM Docker volume'deki veritabanının yedek kopyasını oluşturur

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - VERİTABANI YEDEKLEMESİ
echo ===============================================
echo.

REM Backup klasörünü oluştur
if not exist "backups" (
    mkdir backups
    echo [OK] Backups klasörü oluşturuldu.
)

REM Timestamp oluştur (YYYY-MM-DD_HH-MM-SS)
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ('time /t') do (set mytime=%%a-%%b)
set timestamp=%mydate%_%mytime%

echo [*] Yedek dosya adı: lojman.db.backup_%timestamp%.tar.gz
echo.

REM Docker volume'den veri çıkart
echo [*] Veritabanı volume'den çıkartılıyor...
docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v "%cd%\backups:/backup" ^
  busybox tar czf /backup/lojman.db.backup_%timestamp%.tar.gz -C /data lojman.db 2>NUL

if %ERRORLEVEL% equ 0 (
    echo [OK] Yedek başarıyla oluşturuldu!
    echo     Dosya: backups\lojman.db.backup_%timestamp%.tar.gz
    echo.
    echo ===============================================
    echo [OK] VERİTABANI YEDEKLEMESİ TAMAMLANDI
    echo ===============================================
) else (
    echo [HATA] Yedekleme başarısız oldu!
    echo Lütfen Docker'ın çalışıp çalışmadığını kontrol edin.
)

echo.
pause
