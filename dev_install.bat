@echo off
setlocal
title Fear and Hunger Accessibility - DEV Installer

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\dev_install.ps1"

echo.
echo Press any key to close this window . . .
pause >nul
