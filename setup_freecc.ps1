# setup_freecc.ps1 - Automated Setup for Free Claude Code with NVIDIA NIM

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       Free Claude Code - Automated Setup Helper" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Ask for NVIDIA NIM Key
$NimKey = ""
while ([string]::IsNullOrWhiteSpace($NimKey)) {
    $NimKey = Read-Host "Please enter your NVIDIA NIM API Key (starts with nvapi-)"
    $NimKey = $NimKey.Trim()
    if (-not $NimKey.StartsWith("nvapi-")) {
        Write-Host "Warning: Nvidia NIM keys typically start with 'nvapi-'. Please double check." -ForegroundColor Yellow
    }
}

# 2. Paths
$HomeFccDir = Join-Path $HOME ".fcc"
$HomeFccEnv = Join-Path $HomeFccDir ".env"
$LocalRepoDir = Join-Path $PSScriptRoot "free-claude-code"
$LocalEnv = Join-Path $LocalRepoDir ".env"
$LocalExampleEnv = Join-Path $LocalRepoDir ".env.example"

Write-Host "`n[Step 1] Creating config folders and files..." -ForegroundColor Green

# Ensure Home FCC folder exists
if (-not (Test-Path $HomeFccDir)) {
    New-Item -ItemType Directory -Path $HomeFccDir | Out-Null
    Write-Host "Created folder: $HomeFccDir"
}

# Initialize env files if they don't exist
if (-not (Test-Path $LocalExampleEnv)) {
    throw "Could not find .env.example at $LocalExampleEnv. Please make sure the repo was cloned correctly."
}

# Write config files helper
function Configure-EnvFile ($Path) {
    if (Test-Path $Path) {
        Write-Host "Config file already exists at $Path. Backing up..." -ForegroundColor Yellow
        Copy-Item $Path "$Path.bak" -Force
    }
    
    # Read the example template
    $Content = Get-Content $LocalExampleEnv -Raw
    
    # Replace key lines
    $Content = $Content -replace 'NVIDIA_NIM_API_KEY=""', "NVIDIA_NIM_API_KEY=`"$NimKey`""
    $Content = $Content -replace 'MODEL_OPUS=', 'MODEL_OPUS="nvidia_nim/meta/llama-3.3-70b-instruct"'
    $Content = $Content -replace 'MODEL_SONNET=', 'MODEL_SONNET="nvidia_nim/meta/llama-3.3-70b-instruct"'
    $Content = $Content -replace 'MODEL_HAIKU=', 'MODEL_HAIKU="nvidia_nim/meta/llama-3.3-70b-instruct"'
    $Content = $Content -replace 'MODEL="nvidia_nim/nvidia/nemotron-3-super-120b-a12b"', 'MODEL="nvidia_nim/meta/llama-3.3-70b-instruct"'
    $Content = $Content -replace 'ANTHROPIC_AUTH_TOKEN=""', 'ANTHROPIC_AUTH_TOKEN="freecc"'
    
    # Write to target path
    [IO.File]::WriteAllText($Path, $Content, [System.Text.Encoding]::UTF8)
    Write-Host "Configured: $Path" -ForegroundColor Cyan
}

Configure-EnvFile $LocalEnv
Configure-EnvFile $HomeFccEnv

# 3. Run Repository Installer
Write-Host "`n[Step 2] Running the Free Claude Code official installer..." -ForegroundColor Green
$InstallerPath = Join-Path $LocalRepoDir "scripts\install.ps1"
if (-not (Test-Path $InstallerPath)) {
    throw "Could not find installer script at $InstallerPath"
}

# Run the installer
& powershell.exe -ExecutionPolicy Bypass -File $InstallerPath

# 4. Create local run_proxy.bat launcher
Write-Host "`n[Step 3] Creating quick start launchers..." -ForegroundColor Green
$BatContent = @"
@echo off
title Free Claude Code Proxy
echo Starting Free Claude Code Proxy...
cd /d "%~dp0free-claude-code"
uv run uvicorn server:app --host 0.0.0.0 --port 8082
pause
"@

$BatPath = Join-Path $PSScriptRoot "run_proxy.bat"
[IO.File]::WriteAllText($BatPath, $BatContent, [System.Text.Encoding]::ASCII)
Write-Host "Created launcher batch script: $BatPath" -ForegroundColor Cyan

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host "Setup Completed successfully!" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "To run the proxy server, execute:"
Write-Host "  .\run_proxy.bat" -ForegroundColor Cyan
Write-Host ""
Write-Host "Once the proxy is running, open a new terminal and run:"
Write-Host "  `$env:ANTHROPIC_BASE_URL=`"http://localhost:8082`"" -ForegroundColor Cyan
Write-Host "  claude" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Green
