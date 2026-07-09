@echo off
setlocal
title Fear and Hunger Accessibility - DEV Uninstaller

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\dev_uninstall.ps1"

echo.
echo Press any key to close this window . . .
pause >nul
