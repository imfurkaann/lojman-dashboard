@echo off
chcp 65001 >nul 2>&1
cls
echo ===============================================
echo   LOJMAN DASHBOARD - YEDEK GERİ YÜKLEME (IMPORT)
echo ===============================================
echo.

set "YEDEK_DIR=yedek"

if not exist "%YEDEK_DIR%" (
    echo [HATA] '%YEDEK_DIR%' klasörü bulunamadı!
    pause & exit /b 1
)

echo [1/5] Docker konteyneri durduruluyor...
docker compose down

echo [2/5] Veritabanı önbelleği temizleniyor...
if exist "data\lojman.db-wal" del /f /q "data\lojman.db-wal"
if exist "data\lojman.db-shm" del /f /q "data\lojman.db-shm"

echo [3/5] Veritabanı aktarılıyor (data/lojman.db)...
if not exist "data" mkdir "data"
if exist "%YEDEK_DIR%\lojman.db" (
    copy /Y "%YEDEK_DIR%\lojman.db" "data\lojman.db" >nul
    echo [OK] lojman.db aktarıldı.
) else (
    echo [UYARI] yedek/lojman.db bulunamadı!
)

echo [4/5] Görseller aktarılıyor (public/uploads)...
if not exist "public\uploads" mkdir "public\uploads"
if exist "%YEDEK_DIR%\uploads" (
    xcopy /E /I /Y "%YEDEK_DIR%\uploads" "public\uploads" >nul 2>&1
    echo [OK] Görseller aktarıldı.
) else (
    echo [UYARI] yedek/uploads bulunamadı!
)

if exist "%YEDEK_DIR%\whatsapp-auth" (
    if not exist "data\whatsapp-auth" mkdir "data\whatsapp-auth"
    xcopy /E /I /Y "%YEDEK_DIR%\whatsapp-auth" "data\whatsapp-auth" >nul 2>&1
)

echo.
echo [5/5] Docker konteyneri başlatılıyor...
docker compose up -d

echo.
echo ===============================================
echo   ✅ YEDEK ENTEGRASYONU TAMAMLANDI!
echo ===============================================
pause
