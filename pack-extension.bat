@echo off
setlocal

set "XPI=%~dp0obsidian-source-note.xpi"
set "EXT_DIR=%~dp0extension"
set "TEMP_XPI=%~dp0obsidian-source-note.xpi.tmp"

echo Packing extension...

:: Check that the extension directory exists and has a manifest
if not exist "%EXT_DIR%\manifest.json" (
    echo ERROR: manifest.json not found in %EXT_DIR%
    pause
    exit /b 1
)

:: Remove old XPI and any leftover temp file
if exist "%TEMP_XPI%" del /f "%TEMP_XPI%"
if exist "%XPI%" (
    del /f "%XPI%"
    if exist "%XPI%" (
        echo ERROR: Cannot delete old XPI — is Firefox using it? Close Firefox and retry.
        pause
        exit /b 1
    )
)

:: Build the XPI using PowerShell — write to temp file first, then rename
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "try {" ^
    "  Add-Type -Assembly 'System.IO.Compression.FileSystem';" ^
    "  $src = '%EXT_DIR%';" ^
    "  $dst = '%TEMP_XPI%';" ^
    "  $zip = [System.IO.Compression.ZipFile]::Open($dst, 'Create');" ^
    "  $files = Get-ChildItem -Path $src -Recurse -File;" ^
    "  foreach ($f in $files) {" ^
    "    $entry = $f.FullName.Substring($src.Length + 1) -replace '\\','/';" ^
    "    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, 'Optimal') | Out-Null;" ^
    "  }" ^
    "  $zip.Dispose();" ^
    "  Write-Output 'OK';" ^
    "} catch {" ^
    "  Write-Error $_.Exception.Message;" ^
    "  exit 1;" ^
    "}"

if %errorlevel% neq 0 (
    echo ERROR: Failed to create XPI archive.
    if exist "%TEMP_XPI%" del /f "%TEMP_XPI%"
    pause
    exit /b 1
)

:: Verify temp file exists and is non-empty
if not exist "%TEMP_XPI%" (
    echo ERROR: XPI file was not created.
    pause
    exit /b 1
)

:: Atomic rename — avoids partial/corrupt file
move /y "%TEMP_XPI%" "%XPI%" >nul

echo.
echo Done! Created obsidian-source-note.xpi
echo.
echo To install in Firefox:
echo   1. Open about:addons
echo   2. Click the gear icon ^> "Install Add-on From File..."
echo   3. Select: %XPI%
echo.
pause
