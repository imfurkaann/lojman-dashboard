@echo off
chcp 65001 >nul 2>&1
cls
echo ===============================================
echo   LOJMAN DASHBOARD - DEPLOYMENT
echo   Adres: http://162.19.242.35:33333
echo ===============================================
echo.

echo [1/3] Git reposu güncelleniyor...
git pull origin main

echo [2/3] Docker konteyneri yeniden başlatılıyor...
docker compose down
docker compose up -d --build

echo [3/3] Konteyner durumu kontrol ediliyor...
docker compose ps

echo.
echo ===============================================
echo   DAĞITIM TAMAMLANDI!
echo   Tarayıcıdan erişebilirsiniz: http://162.19.242.35:33333
echo ===============================================
pause
