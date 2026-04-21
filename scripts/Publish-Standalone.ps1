# Builds a single downloadable InstallerManager.exe with the .NET 8 runtime bundled.
# End users do not install .NET separately; first launch may extract files to a cache (normal for single-file).
#
# Usage (from repo root):
#   .\scripts\Publish-Standalone.ps1
# Output:
#   .\artifacts\InstallerManager-Standalone\InstallerManager.exe

[CmdletBinding()]
param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$OutputDir = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if ([string]::IsNullOrWhiteSpace($OutputDir)) {
    $OutputDir = Join-Path $RepoRoot "artifacts\InstallerManager-Standalone"
}

$Project = Join-Path $RepoRoot "src\InstallerManager.App\InstallerManager.App.csproj"

Write-Host "Publishing self-contained single-file to: $OutputDir" -ForegroundColor Cyan

dotnet publish $Project `
    -c $Configuration `
    -r $Runtime `
    --self-contained true `
    -o $OutputDir `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=none `
    -p:DebugSymbols=false

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$exe = Join-Path $OutputDir "InstallerManager.exe"
if (-not (Test-Path $exe)) {
    Write-Error "Expected output not found: $exe"
}

Write-Host ""
Write-Host "Done. Distribute this file (or zip the folder if you add extra files):" -ForegroundColor Green
Write-Host "  $exe" -ForegroundColor Green
Write-Host ""
Write-Host "Size (approx):" -ForegroundColor DarkGray
Get-Item $exe | Select-Object Name, @{ N = "MB"; E = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize
