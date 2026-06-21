@echo off
REM build_release.bat — Build FFT for Windows x64
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo === FFT Build Script (Windows x64) ===

if exist ".tools\go\bin\go.exe" (
  set GO_BIN=%CD%\.tools\go\bin\go.exe
) else (
  set GO_BIN=go
)

echo ^>^>^> Installing frontend dependencies...
call npm install --prefix frontend --cache .cache\npm || exit /b 1

echo ^>^>^> Building frontend...
call npm run build || exit /b 1

echo ^>^>^> Building Go binary...
if not exist dist\FFT\frontend mkdir dist\FFT\frontend
set GOPATH=%CD%\.cache\gopath
set GOCACHE=%CD%\.cache\go-build
set GOOS=windows
set GOARCH=amd64
"%GO_BIN%" build -trimpath -ldflags="-s -w" -o dist\FFT\FFT.exe .\cmd\server || exit /b 1

xcopy /e /i /q frontend\dist dist\FFT\frontend\dist >nul
copy bench_leaderboard.json dist\FFT\bench_leaderboard.json >nul

(
echo FFT - FFmpeg AV1 Transcoder
echo.
echo Requirements:
echo   - ffmpeg.exe and ffprobe.exe must be in PATH
echo.
echo Usage:
echo   1. Double-click FFT.exe or run it from a terminal
echo   2. Open http://127.0.0.1:8166
echo.
echo Environment variables:
echo   FFT_PORT=8166
echo   FFT_OPEN_BROWSER=true
) > dist\FFT\README.txt

if not exist release mkdir release

echo ^>^>^> Packaging lite version...
if exist release\FFT-windows-x64-lite rmdir /s /q release\FFT-windows-x64-lite
xcopy /e /i /q dist\FFT release\FFT-windows-x64-lite >nul
powershell -NoProfile -Command "Compress-Archive -Force -Path 'release\FFT-windows-x64-lite' -DestinationPath 'release\FFT-windows-x64-lite.zip'"
rmdir /s /q release\FFT-windows-x64-lite

echo ^>^>^> Packaging full version...
if exist release\FFT-windows-x64-full rmdir /s /q release\FFT-windows-x64-full
xcopy /e /i /q dist\FFT release\FFT-windows-x64-full >nul
where ffmpeg >nul 2>&1
if %errorlevel%==0 (
  for /f "delims=" %%i in ('where ffmpeg') do copy "%%i" "release\FFT-windows-x64-full\ffmpeg.exe" >nul
  for /f "delims=" %%i in ('where ffprobe') do copy "%%i" "release\FFT-windows-x64-full\ffprobe.exe" >nul
) else (
  echo ffmpeg not found in PATH; full package will not include ffmpeg.
)
powershell -NoProfile -Command "Compress-Archive -Force -Path 'release\FFT-windows-x64-full' -DestinationPath 'release\FFT-windows-x64-full.zip'"
rmdir /s /q release\FFT-windows-x64-full

echo === Build complete ===
dir /b release\FFT-windows-x64-*.zip
