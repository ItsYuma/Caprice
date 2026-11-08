$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$SkipSystem = $args -contains "--skip-system" -or $args -contains "--help" -or $args -contains "-h"

function Install-CapriceTool {
  param(
    [string]$Id
  )
  & winget install --id $Id -e --scope user --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -eq 0) {
    return
  }
  Write-Host "winget has no per-user installer for $Id. Trying the machine installer."
  & winget install --id $Id -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Error "winget could not install $Id"
  }
}

function Test-CapriceExecutable {
  param(
    [string]$Path
  )
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $false
  }
  if ($Path -like "*\Microsoft\WindowsApps\*") {
    return $false
  }
  return Test-Path -LiteralPath $Path
}

function Get-CapricePythonCommand {
  param(
    [string]$Name
  )
  return Get-Command $Name -All -ErrorAction SilentlyContinue |
    Where-Object { Test-CapriceExecutable $_.Source } |
    Select-Object -First 1
}

function Get-CapricePython {
  $py = Get-CapricePythonCommand "py"
  if ($py) {
    $exe = & $py.Source -3 -c "import sys; print(sys.executable)"
    if ($LASTEXITCODE -eq 0 -and (Test-CapriceExecutable $exe.Trim())) {
      return $exe.Trim()
    }
  }
  foreach ($name in @("python", "python3")) {
    $command = Get-CapricePythonCommand $name
    if (-not $command) {
      continue
    }
    & $command.Source -c "import sys" | Out-Null
    if ($LASTEXITCODE -eq 0) {
      return $command.Source
    }
  }
  return $null
}

function Install-CapricePython {
  $arch = "amd64"
  $folder = "Python312"
  if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
    $arch = "arm64"
    $folder = "Python312-arm64"
  } elseif ($env:PROCESSOR_ARCHITECTURE -eq "x86") {
    $arch = ""
    $folder = "Python312-32"
  }
  $version = "3.12.10"
  if ($arch -eq "") {
    $fileName = "python-$version.exe"
  } else {
    $fileName = "python-$version-$arch.exe"
  }
  $url = "https://www.python.org/ftp/python/$version/$fileName"
  $installer = Join-Path $env:TEMP $fileName
  Write-Host "Downloading Python $version"
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -Uri $url -OutFile $installer
  Write-Host "Installing Python $version for this user"
  $proc = Start-Process -FilePath $installer -ArgumentList @(
    "/quiet",
    "InstallAllUsers=0",
    "PrependPath=1",
    "Include_launcher=1",
    "Include_pip=1",
    "Include_test=0"
  ) -Wait -PassThru
  if ($proc.ExitCode -ne 0 -and $proc.ExitCode -ne 3010) {
    Write-Error "Python installer exited with $($proc.ExitCode)"
  }
  $installed = Join-Path $env:LOCALAPPDATA "Programs\Python\$folder\python.exe"
  if (Test-Path -LiteralPath $installed) {
    return $installed
  }
  $found = Get-ChildItem -Path (Join-Path $env:LOCALAPPDATA "Programs\Python") -Filter python.exe -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($found) {
    return $found.FullName
  }
  Write-Error "Python installed but python.exe was not found."
}

function Install-CapriceRust {
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  $rustup = Join-Path $cargoBin "rustup.exe"
  if (-not (Test-Path -LiteralPath $rustup)) {
    $arch = "x86_64"
    if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") {
      $arch = "aarch64"
    }
    $init = Join-Path $env:TEMP "rustup-init.exe"
    Write-Host "Downloading rustup"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://win.rustup.rs/$arch" -OutFile $init
    Write-Host "Installing rustup"
    $proc = Start-Process -FilePath $init -ArgumentList @("-y", "--default-toolchain", "none") -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
      Write-Error "rustup-init exited with $($proc.ExitCode)"
    }
  }
  $env:PATH = "$cargoBin;$env:PATH"
  & $rustup toolchain install 1.99.1 --profile minimal --component rustfmt --component clippy
  if ($LASTEXITCODE -ne 0) {
    Write-Error "rustup could not install 1.99.1"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $cargoBin "cargo.exe"))) {
    Write-Error "cargo.exe was not found."
  }
}

if (-not $SkipSystem) {
  $webview = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
  if (-not $webview) {
    Install-CapriceTool "Microsoft.EdgeWebView2Runtime"
  }
  Install-CapriceRust
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

$pythonPath = Get-CapricePython
if (-not $pythonPath) {
  if ($SkipSystem) {
    Write-Error "python is not installed."
  }
  $pythonPath = Install-CapricePython
}
$env:PATH = "$(Split-Path -Parent $pythonPath);$env:PATH"

& bun scripts/install.ts --python $pythonPath @args
exit $LASTEXITCODE
