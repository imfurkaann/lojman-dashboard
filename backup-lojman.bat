@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - BACKUP
echo ===============================================
echo.

REM -----------------------------------------------
REM Tarih/Saat - PowerShell ile güvenli al
REM -----------------------------------------------
for /f "usebackq" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'"`) do set "TIMESTAMP=%%i"
set "BACKUP_DIR=backup_%TIMESTAMP%"

echo [1/5] Backup klasoru olusturuluyor: %BACKUP_DIR%
mkdir "%BACKUP_DIR%" 2>nul
if not exist "%BACKUP_DIR%" (
    echo [HATA] Klasor olusturulamadi!
    pause & exit /b 1
)
echo [OK] Klasor hazir.

REM -----------------------------------------------
REM Container çalışıyor mu?
REM -----------------------------------------------
echo.
echo [2/5] Container kontrol ediliyor...
docker inspect --format "{{.State.Running}}" lojman-dashboard 2>nul | findstr "true" >nul
if errorlevel 1 (
    echo [HATA] lojman-dashboard container'i calisiyor degil!
    echo        Once start.bat ile uygulamayi baslatın.
    rmdir "%BACKUP_DIR%" >nul 2>&1
    pause & exit /b 1
)
echo [OK] Container calisiyor.

REM -----------------------------------------------
REM Database yedekle
REM -----------------------------------------------
echo.
echo [3/5] Database yedekleniyor...
docker cp lojman-dashboard:/data/lojman.db "%BACKUP_DIR%\lojman.db" 2>nul
if errorlevel 1 (
    REM Alternatif yol dene
    docker cp lojman-dashboard:/app/lojman.db "%BACKUP_DIR%\lojman.db" 2>nul
)
docker cp lojman-dashboard:/data/lojman.db-wal "%BACKUP_DIR%\lojman.db-wal" 2>nul
docker cp lojman-dashboard:/data/lojman.db-shm "%BACKUP_DIR%\lojman.db-shm" 2>nul
if exist "%BACKUP_DIR%\lojman.db" (
    echo [OK] Database yedeklendi.
) else (
    echo [UYARI] Database yedeklenemedi - container icindeki yolu kontrol edin.
)
if exist "%BACKUP_DIR%\lojman.db-wal" (
    echo [OK] SQLite WAL dosyasi yedeklendi.
) else (
    echo [UYARI] SQLite WAL dosyasi bulunamadi veya yedeklenemedi.
)
if exist "%BACKUP_DIR%\lojman.db-shm" (
    echo [OK] SQLite SHM dosyasi yedeklendi.
) else (
    echo [UYARI] SQLite SHM dosyasi bulunamadi veya yedeklenemedi.
)

REM -----------------------------------------------
REM Görseller yedekle
REM -----------------------------------------------
echo.
echo [4/5] Gorseller yedekleniyor...
docker cp lojman-dashboard:/app/public/uploads "%BACKUP_DIR%\uploads" 2>nul
if errorlevel 1 (
    echo [UYARI] Gorseller yedeklenemedi - /app/public/uploads yolu bulunamadi.
) else (
    echo [OK] Gorseller yedeklendi.
)

REM -----------------------------------------------
REM WhatsApp yedekle
REM -----------------------------------------------
echo.
echo [5/5] WhatsApp verisi yedekleniyor...
docker cp lojman-dashboard:/data/whatsapp-auth "%BACKUP_DIR%\whatsapp-auth" 2>nul
if errorlevel 1 (
    echo [UYARI] WhatsApp verisi yedeklenemedi - /data/whatsapp-auth yolu bulunamadi.
) else (
    echo [OK] WhatsApp verisi yedeklendi.
)

REM -----------------------------------------------
REM Sonuç
REM -----------------------------------------------
echo.
echo ===============================================
echo   BACKUP TAMAMLANDI
echo ===============================================
echo.
echo Klasor : %CD%\%BACKUP_DIR%
echo.
echo Icerik:
dir "%BACKUP_DIR%" /B /S
echo.

REM Toplam boyut
for /f "tokens=3" %%a in ('dir "%BACKUP_DIR%" /S /-C ^| findstr /C:"bayt" /C:"bytes" ^| findstr /V "bos\|free\|0 "') do set "TOTAL_SIZE=%%a"
echo Toplam boyut: %TOTAL_SIZE% byte
echo.
pause
exit /b 0