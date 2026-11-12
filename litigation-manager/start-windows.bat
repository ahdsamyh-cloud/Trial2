@echo off
rem Double-click this file to start Litigation Manager on Windows.
title Litigation Manager
cd /d "%~dp0"
echo ==============================================
echo   Litigation Manager
echo ==============================================
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed.
  echo Install the LTS version from https://nodejs.org, then double-click this file again.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)
echo Starting... your browser will open at http://localhost:3000
echo Keep this window open while you use the app. Close it to stop the app.
echo.
node --disable-warning=ExperimentalWarning server.js --open
echo.
echo The app has stopped.
pause
