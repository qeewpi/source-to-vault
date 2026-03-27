@echo off
:: Obsidian Source Note Creator - Uninstaller

setlocal

set EXT_ID=obsidian-source-note@ashley

reg delete "HKCU\Software\Mozilla\Extensions\{ec8030f7-c20a-464f-9b0e-13a3a9e97384}" /v "%EXT_ID%" /f

if %errorlevel% equ 0 (
    echo Extension uninstalled. Restart Firefox to take effect.
) else (
    echo Nothing to uninstall.
)

pause
