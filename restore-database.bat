@echo off
REM Lojman Dashboard - Database Restore Script
REM Yedeklenmiş bir veritabanını geri yükler

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - VERİTABANI GERİ YÜKLEME
echo ===============================================
echo.

REM Docker'ın çalışıp çalışmadığını kontrol et
docker ps >NUL 2>&1
if %ERRORLEVEL% neq 0 (
    echo [HATA] Docker Desktop çalışmıyor!
    echo Lütfen Docker Desktop'ı açın ve tekrar deneyin.
    echo.
    pause
    exit /b 1
)

REM Backup dosyalarını listele
echo [*] Mevcut yedekler:
echo.
dir /b backups\lojman.db.backup_*.tar.gz 2>NUL
if %ERRORLEVEL% neq 0 (
    echo [HATA] Backup dosyası bulunamadı!
    echo Lütfen önce backup-database.bat ile yedek oluşturun.
    echo.
    pause
    exit /b 1
)

echo.
set /p backupfile="Geri yüklenecek dosya adını girin (sadece dosya adı): "

if not exist "backups\%backupfile%" (
    echo [HATA] Dosya bulunamadı: backups\%backupfile%
    echo.
    pause
    exit /b 1
)

REM Uyarı
echo.
echo ===============================================
echo [!] UYARI: Mevcut veritabanı silinecek!
echo ===============================================
echo.
set /p confirm="Emin misiniz? (E/H): "

if /i not "%confirm%"=="E" (
    echo Geri yükleme iptal edildi.
    echo.
    pause
    exit /b 0
)

echo.
echo [*] Veritabanı geri yükleniyor...
echo.

REM Docker container'ı durdur (varsa)
docker stop lojman-dashboard >NUL 2>&1

REM Volume'ü temizle ve geri yükle
docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v "%cd%\backups:/backup" ^
  busybox sh -c "rm -f /data/lojman.db && tar xzf /backup/%backupfile% -C /data" 2>NUL

if %ERRORLEVEL% equ 0 (
    echo [OK] Veritabanı başarıyla geri yüklendi!
    echo.
    echo ===============================================
    echo [OK] GERİ YÜKLEME TAMAMLANDI
    echo ===============================================
    echo.
    echo Uygulamayı başlatmak için start-dashboard.bat komutunu çalıştırın.
) else (
    echo [HATA] Geri yükleme başarısız oldu!
    echo Lütfen Docker'ın çalıştığından emin olun.
)

echo.
pause
