@echo off
chcp 65001 >nul 2>&1
cls
echo ===============================================
echo   LOJMAN DASHBOARD - YEDEK ALMA (DB + GÖRSELLER)
echo ===============================================
echo.

set "YEDEK_DIR=yedek"

if not exist "%YEDEK_DIR%" mkdir "%YEDEK_DIR%"

echo [1/3] Veritabanı yedekleniyor (lojman.db)...
docker inspect --format "{{.State.Running}}" lojman-dashboard 2>nul | findstr "true" >nul
if not errorlevel 1 (
    docker exec lojman-dashboard sqlite3 /data/lojman.db ".backup '/data/backup_temp.db'" 2>nul
    docker cp lojman-dashboard:/data/backup_temp.db "%YEDEK_DIR%\lojman.db" 2>nul
    docker exec lojman-dashboard rm -f /data/backup_temp.db 2>nul
)
if not exist "%YEDEK_DIR%\lojman.db" (
    if exist "data\lojman.db" copy /Y "data\lojman.db" "%YEDEK_DIR%\lojman.db" >nul
)

echo [2/3] Yüklenen görseller yedekleniyor (public/uploads)...
if not exist "%YEDEK_DIR%\uploads" mkdir "%YEDEK_DIR%\uploads"
docker inspect --format "{{.State.Running}}" lojman-dashboard 2>nul | findstr "true" >nul
if not errorlevel 1 (
    docker cp lojman-dashboard:/app/public/uploads "%YEDEK_DIR%\" 2>nul
)
if exist "public\uploads" (
    xcopy /E /I /Y "public\uploads" "%YEDEK_DIR%\uploads" >nul 2>&1
)

echo [3/3] WhatsApp oturum verisi yedekleniyor (whatsapp-auth)...
if not exist "%YEDEK_DIR%\whatsapp-auth" mkdir "%YEDEK_DIR%\whatsapp-auth"
docker inspect --format "{{.State.Running}}" lojman-dashboard 2>nul | findstr "true" >nul
if not errorlevel 1 (
    docker cp lojman-dashboard:/data/whatsapp-auth "%YEDEK_DIR%\" 2>nul
)
if exist "data\whatsapp-auth" (
    xcopy /E /I /Y "data\whatsapp-auth" "%YEDEK_DIR%\whatsapp-auth" >nul 2>&1
)

echo.
echo ===============================================
echo   ✅ YEDEKLEME TAMAMLANDI!
echo   Klasör: %CD%\yedek
echo ===============================================
