@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo ============================================================
  echo   Node.js bulunamadi! / Node.js is not installed.
  echo ============================================================
  set /p ANS=Resmi Node.js LTS otomatik kurulsun mu? [E/H]: 
  if /i "%ANS%"=="H" goto :cancel
  if /i "%ANS%"=="N" goto :cancel

  where winget >nul 2>nul
  if %errorlevel% equ 0 (
    echo winget ile resmi OpenJS Node.js LTS kuruluyor...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  ) else (
    echo Tarayicida resmi https://nodejs.org/en/download sayfasi aciliyor...
    start https://nodejs.org/en/download
    echo Kurulumu tamamladiktan sonra bu dosyaya tekrar cift tiklayin.
    pause
    exit /b 1
  )

  where node >nul 2>nul
  if %errorlevel% neq 0 (
    echo Node.js kuruldu! Aktif olmasi icin bu pencereyi kapatip dosyaya tekrar cift tiklayin.
    pause
    exit /b 0
  )
)

if "%PORT%"=="" set PORT=3456
echo LinePulse baslatiliyor: http://127.0.0.1:%PORT%
echo Kapatmak icin bu pencereyi kapatabilir veya Ctrl+C yapabilirsiniz.

start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:%PORT%"
node server/index.js
pause
exit /b 0

:cancel
echo Kurulum iptal edildi. Manuel kurulum: https://nodejs.org
pause
exit /b 1
