#!/usr/bin/env bash
# build_release.sh — Build FFT for macOS arm64
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

GO_BIN="${GO_BIN:-$SCRIPT_DIR/.tools/go/bin/go}"
if [ ! -x "$GO_BIN" ]; then
  GO_BIN="${GO_BIN:-go}"
fi

echo "=== FFT Build Script (macOS arm64) ==="

echo ">>> Installing frontend dependencies..."
npm install --prefix frontend --cache .cache/npm

echo ">>> Building frontend..."
npm run build

echo ">>> Building Go binary..."
mkdir -p dist/FFT/frontend
PATH="$(dirname "$GO_BIN"):$PATH" \
GOPATH="$SCRIPT_DIR/.cache/gopath" \
GOCACHE="$SCRIPT_DIR/.cache/go-build" \
GOOS=darwin GOARCH=arm64 \
"$GO_BIN" build -trimpath -ldflags="-s -w -linkmode=external" -o dist/FFT/FFT ./cmd/server

cp -R frontend/dist dist/FFT/frontend/dist
cp bench_leaderboard.json dist/FFT/

cat > dist/FFT/README.txt << 'READMEEOF'
FFT - FFmpeg AV1 Transcoder

Requirements:
  - ffmpeg and ffprobe must be installed and available in PATH
  - Install via: brew install ffmpeg

Usage:
  1. Open Terminal
  2. cd to this directory
  3. Run: ./FFT
  4. Open http://127.0.0.1:8166

Environment variables:
  FFT_PORT=8166
  FFT_OPEN_BROWSER=true
READMEEOF

echo ">>> Codesigning binary..."
codesign --force --sign - dist/FFT/FFT

echo ">>> Packaging..."
mkdir -p release
rm -rf release/FFT-macos-arm64
cp -R dist/FFT release/FFT-macos-arm64
(cd release && tar czf FFT-macos-arm64.tar.gz FFT-macos-arm64)
rm -rf release/FFT-macos-arm64

echo "=== Build complete: release/FFT-macos-arm64.tar.gz ==="
