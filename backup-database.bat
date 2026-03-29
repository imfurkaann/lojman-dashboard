@echo off
REM Lojman Dashboard - Database Backup Script
REM Creates a backup of the database

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - DATABASE BACKUP
echo ===============================================
echo.

if not exist "backups" (
    mkdir backups
    echo [OK] Backups folder created.
)

for /f "tokens=2-4 delims=/ " %%%%a in ('date /t') do (set mydate=%%%%c-%%%%a-%%%%b)
for /f "tokens=1-2 delims=/: " %%%%a in ('time /t') do (set mytime=%%%%a-%%%%b)
set timestamp=%mydate%_%mytime%

echo [*] Backup filename: lojman.db.backup_%timestamp%.tar.gz
echo.

echo [*] Extracting database from volume...
docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v "%cd%\backups:/backup" ^
  busybox tar czf /backup/lojman.db.backup_%timestamp%.tar.gz -C /data lojman.db 2>NUL

if %ERRORLEVEL% equ 0 (
    echo [OK] Backup created successfully!
    echo     File: backups\lojman.db.backup_%timestamp%.tar.gz
    echo.
    echo ===============================================
    echo [OK] DATABASE BACKUP COMPLETED
    echo ===============================================
) else (
    echo [ERROR] Backup failed!
    echo Please ensure Docker is running.
)

echo.
pause
exit /b 0
