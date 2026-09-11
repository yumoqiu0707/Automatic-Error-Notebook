@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Stop Cuotiji Assistant

echo.
echo   Stopping Cuotiji Assistant ...

set "KILLED="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5178" ^| findstr "LISTENING"') do (
  taskkill /f /pid %%a >nul 2>nul
  if not errorlevel 1 (
    echo   Stopped process PID %%a
    set "KILLED=1"
  )
)

if defined KILLED (
  echo.
  echo   Service stopped. Your mistake book is saved in data\db.json
) else (
  echo   No running service was found on port 5178.
)

echo.
timeout /t 3 >nul
exit /b 0
