@echo off
:: Obsidian Source Note Creator - Permanent Firefox Extension Installer
:: Run this as Administrator

setlocal

set EXT_ID=obsidian-source-note@ashley
set EXT_DIR=%~dp0extension

:: Create the registry key pointing Firefox to the extension folder
:: This makes Firefox load it on every startup — no temp add-on needed
reg add "HKCU\Software\Mozilla\Extensions\{ec8030f7-c20a-464f-9b0e-13a3a9e97384}" /v "%EXT_ID%" /t REG_SZ /d "%EXT_DIR%" /f

if %errorlevel% equ 0 (
    echo.
    echo Extension installed successfully!
    echo.
    echo Restart Firefox and you should see "Obsidian Source Note Creator"
    echo in about:addons under Extensions.
    echo.
    echo Extension folder: %EXT_DIR%
    echo.
) else (
    echo.
    echo Installation failed. Try running this script as Administrator.
    echo.
)

pause
