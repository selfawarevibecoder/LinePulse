@echo off
title Velox Charts (v1.4.1)
cd /d "%~dp0"

set "NODE_BIN=node"
where node >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\nodejs\node.exe" (
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
  )
)

where node >nul 2>&1
if errorlevel 1 (
  echo ============================================================
  echo   Node.js bulunamadi / Node.js not found!
  echo ============================================================
  set /p "ANS=Resmi Node.js LTS otomatik kurulsun mu? (E/H) [E]: "
  if "%ANS%"=="" set "ANS=E"
  if /I "%ANS%"=="E" goto INSTALL_NODE
  if /I "%ANS%"=="Y" goto INSTALL_NODE
  echo Kurulum iptal edildi. Manuel kurulum: https://nodejs.org
  pause
  exit /b 1
)
goto START_APP

:INSTALL_NODE
where winget >nul 2>&1
if errorlevel 1 (
  echo winget bulunamadi; resmi Node.js indirme sayfasi aciliyor...
  start "" "https://nodejs.org"
  pause
  exit /b 1
)
echo Resmi Node.js LTS kuruluyor (OpenJS.NodeJS.LTS)...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
if exist "%ProgramFiles%\nodejs\node.exe" (
  set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1
if errorlevel 1 (
  echo Kurulum tamamlandi! Lutfen bu pencereyi kapatip dosyaya tekrar cift tiklayin.
  pause
  exit /b 0
)

:START_APP
echo Starting Velox Charts at http://localhost:3456 ...
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:3456"
node server\index.js
pause
