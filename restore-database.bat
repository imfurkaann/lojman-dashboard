@echo off
REM Lojman Dashboard - Database Restore Script
REM Restores database from a backup

setlocal enabledelayedexpansion

cls
echo.
echo ===============================================
echo   LOJMAN DASHBOARD - DATABASE RESTORE
echo ===============================================
echo.

docker ps >NUL 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker Desktop is not running!
    echo Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo [*] Available backups:
echo.
dir /b backups\lojman.db.backup_*.tar.gz 2>NUL
if %ERRORLEVEL% neq 0 (
    echo [ERROR] No backup files found!
    echo Please create a backup first using backup-database.bat
    echo.
    pause
    exit /b 1
)

echo.
set /p backupfile="Enter backup filename to restore (filename only): "

if not exist "backups\%backupfile%" (
    echo [ERROR] File not found: backups\%backupfile%
    echo.
    pause
    exit /b 1
)

echo.
echo ===============================================
echo [!] WARNING: Current database will be deleted!
echo ===============================================
echo.
set /p confirm="Are you sure? (Y/N): "

if /i not "%confirm%"=="Y" (
    echo Restore cancelled.
    echo.
    pause
    exit /b 0
)

echo.
echo [*] Restoring database...
echo.

docker stop lojman-dashboard >NUL 2>&1

docker run --rm ^
  -v lojman_dashboard_lojman-db-volume:/data ^
  -v "%cd%\backups:/backup" ^
  busybox sh -c "rm -f /data/lojman.db && tar xzf /backup/%backupfile% -C /data" 2>NUL

if %ERRORLEVEL% equ 0 (
    echo [OK] Database restored successfully!
    echo.
    echo ===============================================
    echo [OK] RESTORE COMPLETED
    echo ===============================================
    echo.
    echo Run start-dashboard.bat to start the application.
) else (
    echo [ERROR] Restore failed!
    echo Please ensure Docker is running.
)

echo.
pause
exit /b 0
