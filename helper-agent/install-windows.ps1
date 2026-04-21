#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the Installer Manager Helper Agent on Windows as a persistent service.

.DESCRIPTION
    1. Ensures Node.js LTS is installed (via winget if missing).
    2. Creates C:\Program Files\InstallerManagerAgent\ with the agent code.
    3. Registers a Windows Service using sc.exe so the agent auto-starts on boot.
    4. Opens TCP port 7334 in Windows Firewall.

.EXAMPLE
    # One-liner in an elevated PowerShell window:
    irm https://it.company.com/installer-agent/install-windows.ps1 | iex
#>

$ErrorActionPreference = 'Stop'
$AgentVersion  = '1.0.0'
$AgentPort     = if ($env:AGENT_PORT)    { $env:AGENT_PORT }    else { '7334' }
$AgentSecret   = if ($env:AGENT_SECRET)  { $env:AGENT_SECRET }  else { [System.Guid]::NewGuid().ToString('N') }
$DownloadBase  = if ($env:AGENT_DOWNLOAD_URL) { $env:AGENT_DOWNLOAD_URL } else { 'https://it.company.com/installer-agent' }
$InstallDir    = 'C:\Program Files\InstallerManagerAgent'
$ServiceName   = 'InstallerManagerAgent'
$LogFile       = "$env:TEMP\InstallerManagerAgent-Install.log"

function Write-Step { param([string]$Msg) Write-Host "  ▶ $Msg" -ForegroundColor Cyan }
function Write-OK   { param([string]$Msg) Write-Host "  ✔ $Msg" -ForegroundColor Green }
function Write-Warn { param([string]$Msg) Write-Host "  ⚠ $Msg" -ForegroundColor Yellow }

Write-Host ''
Write-Host '╔══════════════════════════════════════════════════════╗' -ForegroundColor Yellow
Write-Host '║  Installer Manager Helper Agent — Windows Installer  ║' -ForegroundColor Yellow
Write-Host '╚══════════════════════════════════════════════════════╝' -ForegroundColor Yellow
Write-Host "  Version : $AgentVersion"
Write-Host "  Port    : $AgentPort"
Write-Host ''

# ── 1. Node.js ────────────────────────────────────────────────────────────────
Write-Step 'Checking for Node.js...'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Step 'Installing Node.js LTS via winget...'
    winget install OpenJS.NodeJS.LTS -e `
        --accept-source-agreements --accept-package-agreements `
        --disable-interactivity --silent
    # Refresh PATH
    $env:PATH = [System.Environment]::GetEnvironmentVariable('PATH','Machine') + ';' +
                [System.Environment]::GetEnvironmentVariable('PATH','User')
}
$nodeVer = node --version
Write-OK "Node.js $nodeVer"

# ── 2. Install directory ──────────────────────────────────────────────────────
Write-Step "Creating $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Write-OK $InstallDir

# ── 3. Download (or embed) agent.js ──────────────────────────────────────────
Write-Step 'Downloading agent...'
$agentDest = "$InstallDir\agent.js"
try {
    Invoke-WebRequest -Uri "$DownloadBase/helper-agent/agent.js" -OutFile $agentDest -UseBasicParsing
    Write-OK "agent.js downloaded"
} catch {
    Write-Warn "Download failed ($($_.Exception.Message)) — writing bundled copy."
    # Fallback: copy THIS script's bundled agent code.
    # In production, embed the full agent.js content here between the markers.
    @'
// BUNDLED AGENT — replace this placeholder with the full agent.js content
// when distributing the installer without a download server.
console.error("Bundled agent placeholder. Download the real agent.js.");
process.exit(1);
'@ | Set-Content $agentDest
}

# ── 4. Write .env ─────────────────────────────────────────────────────────────
Write-Step 'Writing configuration...'
@"
AGENT_PORT=$AgentPort
AGENT_SECRET=$AgentSecret
"@ | Set-Content "$InstallDir\.env"
Write-OK '.env written'

Write-Host ''
Write-Host '  ┌─────────────────────────────────────────────────────┐' -ForegroundColor Magenta
Write-Host "  │  Agent Secret: $AgentSecret" -ForegroundColor Magenta
Write-Host '  │  Add this to the backend .env as HELPER_AGENT_SECRET  │' -ForegroundColor Magenta
Write-Host '  └─────────────────────────────────────────────────────┘' -ForegroundColor Magenta
Write-Host ''

# ── 5. Windows Service ────────────────────────────────────────────────────────
Write-Step 'Registering Windows Service...'

# Remove old service if present
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Warn 'Stopping and removing existing service...'
    Stop-Service  -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep 2
}

$nodePath = (Get-Command node).Source
# Wrap in powershell so we can set env vars before launching node
$binPath = "powershell.exe -NonInteractive -NoProfile -Command " +
           "`"Set-Location '$InstallDir'; " +
           "`$env:AGENT_PORT='$AgentPort'; " +
           "`$env:AGENT_SECRET='$AgentSecret'; " +
           "& '$nodePath' agent.js`""

sc.exe create $ServiceName `
    binPath= $binPath `
    start=   auto `
    DisplayName= "Installer Manager Helper Agent" | Out-Null

sc.exe description $ServiceName `
    "Lightweight helper service for IT-managed remote software installation" | Out-Null

sc.exe failure $ServiceName reset= 60 actions= restart/5000/restart/10000/restart/30000 | Out-Null

sc.exe start $ServiceName | Out-Null
Start-Sleep 3

$svc = Get-Service -Name $ServiceName
Write-OK "Service status: $($svc.Status)"

# ── 6. Firewall ───────────────────────────────────────────────────────────────
Write-Step "Opening TCP port $AgentPort in Windows Firewall..."
$existing = Get-NetFirewallRule -DisplayName 'Installer Manager Agent' -ErrorAction SilentlyContinue
if ($existing) { Remove-NetFirewallRule -DisplayName 'Installer Manager Agent' -ErrorAction SilentlyContinue }
New-NetFirewallRule `
    -DisplayName   'Installer Manager Agent' `
    -Direction     Inbound `
    -Protocol      TCP `
    -LocalPort     $AgentPort `
    -Action        Allow `
    -Profile       Any | Out-Null
Write-OK "Firewall rule created (port $AgentPort)"

# ── Done ──────────────────────────────────────────────────────────────────────
Write-Host ''
Write-Host '╔═══════════════════════════════════════╗' -ForegroundColor Green
Write-Host '║   Installation complete!              ║' -ForegroundColor Green
Write-Host "║   Agent listening on port $AgentPort          ║" -ForegroundColor Green
Write-Host '╚═══════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  You can now retry your original request in Microsoft Teams.' -ForegroundColor Cyan
Write-Host ''
