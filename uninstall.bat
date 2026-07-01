@echo off
setlocal
title Fear and Hunger Accessibility - Uninstaller

rem --- Re-launch as administrator if we are not elevated. ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator permission...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\uninstall.ps1"

echo.
echo Press any key to close this window . . .
pause >nul
