@echo off
echo Packing extension...

if exist "%~dp0obsidian-source-note.xpi" del "%~dp0obsidian-source-note.xpi"

powershell -NoProfile -Command "Add-Type -Assembly 'System.IO.Compression.FileSystem'; [System.IO.Compression.ZipFile]::CreateFromDirectory('%~dp0extension', '%~dp0obsidian-source-note.xpi', 'Optimal', 0)"

echo Done! Created obsidian-source-note.xpi
pause
