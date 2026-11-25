@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ============================================================
  echo   Node.js bulunamadi!
  echo   Lutfen https://nodejs.org adresinden LTS surumunu kurun.
  echo ============================================================
  pause
  exit /b 1
)

if "%PORT%"=="" set PORT=3456
echo LinePulse baslatiliyor: http://127.0.0.1:%PORT%
echo Kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.

start "" cmd /c "timeout /t 1 /nobreak >nul && start http://127.0.0.1:%PORT%"
node server/index.js
pause
