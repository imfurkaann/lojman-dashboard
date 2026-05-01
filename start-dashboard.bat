@echo off
setlocal enabledelayedexpansion

:: ===============================================
:: 1. YÖNETİCİ YETKİSİ ALMA (GELİŞMİŞ YÖNTEM)
:: ===============================================
:init
if "%PROCESSOR_ARCHITECTURE%" EQU "amd64" (
   >nul 2>&1 "%SYSTEMROOT%\SysWOW64\cacls.exe" "%SYSTEMROOT%\SysWOW64\config\system"
) else (
   >nul 2>&1 "%SYSTEMROOT%\system32\cacls.exe" "%SYSTEMROOT%\system32\config\system"
)

if '%errorlevel%' NEQ '0' (
    echo [*] Yonetici yetkisi isteniyor... Lutfen ekrana gelen uyariya EVET deyin.
    goto getPrivileges
) else ( goto gotPrivileges )

:getPrivileges
    if '%1'=='ELEV' (del "%temp%\getadmin.vbs" & exit /B)
    echo Set UAC = CreateObject^("Shell.Application"^) > "%temp%\getadmin.vbs"
    echo args = "" >> "%temp%\getadmin.vbs"
    echo For Each strArg in WScript.Arguments >> "%temp%\getadmin.vbs"
    echo args = args ^& " " ^& strArg >> "%temp%\getadmin.vbs"
    echo Next >> "%temp%\getadmin.vbs"
    echo UAC.ShellExecute "cmd.exe", "/c ""%~s0"" ELEV " ^& args, "", "runas", 1 >> "%temp%\getadmin.vbs"
    "%temp%\getadmin.vbs" ELEV
    exit /B

:gotPrivileges
    pushd "%cd%"
    cd /d "%~dp0"

:: ===============================================
:: 2. ANA SCRIPT BAŞLANGICI
:: ===============================================
cls
title Lojman Dashboard - Yonetici Modu
echo ===============================================
echo   LOJMAN DASHBOARD - CALISMAYA HAZIR
echo ===============================================
echo.

:: Docker kontrolü
docker ps >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Docker calismiyor, baslatiliyor...
    if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    ) else (
        echo [HATA] Docker Desktop bulunamadi. Manuel acmaniz gerekiyor.
        pause & exit
    )
    
    echo [*] Docker hazir olana kadar bekleniyor...
    :wait_docker
    timeout /t 5 /nobreak >nul
    docker ps >nul 2>&1
    if %errorLevel% neq 0 goto wait_docker
)

:: Port 3000 temizliği
echo [*] Port 3000 temizleniyor...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Docker Compose
if not exist "docker-compose.yml" (
    echo [HATA] docker-compose.yml bulunamadi!
    echo Konum: %cd%
    pause & exit
)

echo [*] Uygulama ayaga kaldiriliyor...
docker compose up -d
if %errorLevel% neq 0 (
    echo [HATA] Bir seyler ters gitti.
    docker compose logs --tail 20
    pause & exit
)

echo [*] Uygulama aciliyor...
timeout /t 5 >nul
start "" "http://localhost:3000"

echo.
echo [TAMAM] Her sey yolunda. Pencereyi kapatabilirsiniz.
pause