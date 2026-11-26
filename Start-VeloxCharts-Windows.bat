@echo off
title Velox Charts (v1.4.1)
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo ============================================================
  echo   Node.js 20+ bulunamadi / Node.js 20+ not found!
  echo   Lutfen kurun: https://nodejs.org
  echo ============================================================
  start "" "https://nodejs.org"
  pause
  exit /b 1
)

echo Starting Velox Charts at http://localhost:3456 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3456"
node server\index.js
pause
