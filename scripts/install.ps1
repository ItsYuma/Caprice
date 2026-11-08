$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$SkipSystem = $args -contains "--skip-system" -or $args -contains "--help" -or $args -contains "-h"

function Install-CapriceTool {
  param(
    [string]$Id
  )
  winget install --id $Id -e --scope user --accept-package-agreements --accept-source-agreements
}

if (-not $SkipSystem) {
  $webview = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
  if (-not $webview) {
    Install-CapriceTool "Microsoft.EdgeWebView2Runtime"
  }
  if (-not (Get-Command rustup -ErrorAction SilentlyContinue)) {
    Install-CapriceTool "Rustlang.Rustup"
  }
  $python = Get-Command py, python3, python -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $python) {
    Install-CapriceTool "Python.Python.3.12"
  }
}

$env:BUN_VERSION = "1.4.4"
$bun = Join-Path $env:USERPROFILE ".bun\bin\bun.exe"
if (-not (Test-Path $bun)) {
  irm https://bun.sh/install.ps1 | iex
}
$env:PATH = "$(Join-Path $env:USERPROFILE '.bun\bin');$env:PATH"

if ($args -contains "--help" -or $args -contains "-h") {
  & bun scripts/install.ts @args
  exit $LASTEXITCODE
}

$pythonCommand = Get-Command py, python3, python -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $pythonCommand) {
  Write-Error "python3 is not installed."
}
if ($pythonCommand.Name -eq "py") {
  $pythonPath = & py -3 -c "import sys; print(sys.executable)"
} else {
  $pythonPath = $pythonCommand.Source
}

& bun scripts/install.ts --python $pythonPath @args
exit $LASTEXITCODE
