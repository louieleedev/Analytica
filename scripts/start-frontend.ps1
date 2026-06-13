$ErrorActionPreference = "Stop"

$frontendPath = Join-Path $PSScriptRoot "..\frontend"
Set-Location $frontendPath

if (-not (Test-Path "node_modules")) {
    npm install
}

npm start
