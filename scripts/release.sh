#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
npm run build
go test ./...
mkdir -p dist
GOOS=darwin GOARCH=arm64 go build -o dist/taskpilot-darwin-arm64 ./cmd/taskpilot
GOOS=darwin GOARCH=amd64 go build -o dist/taskpilot-darwin-amd64 ./cmd/taskpilot
GOOS=windows GOARCH=amd64 go build -o dist/taskpilot-windows-amd64.exe ./cmd/taskpilot
shasum -a 256 dist/* > dist/SHA256SUMS
