#Requires -RunAsAdministrator
<#
.SYNOPSIS
  一键卸载 NSSM 管理的 Windows 服务。

.DESCRIPTION
  读取 services.json，对所有服务执行 stop + remove。
  不管 enabled 是 true 还是 false，全部卸掉。
#>

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── 确保 nssm.exe 可用 ─────────────────────────────────────

$nssmSystem = Join-Path $env:SystemRoot "System32\nssm.exe"
$nssmLocal  = Join-Path $scriptDir "nssm.exe"

$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
if ($nssmCmd) {
    $nssmExe = $nssmCmd.Source
} elseif (Test-Path $nssmSystem) {
    $nssmExe = $nssmSystem
} elseif (Test-Path $nssmLocal) {
    $nssmExe = $nssmLocal
} else {
    Write-Host "nssm.exe not found.  Nothing to uninstall with." -ForegroundColor Red
    exit 1
}

# ── 读取配置 ────────────────────────────────────────────────

$configPath = Join-Path $scriptDir "services.json"
if (-not (Test-Path $configPath)) {
    Write-Host "✗ services.json not found." -ForegroundColor Red
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$all = $config.services
if ($all.Count -eq 0) {
    Write-Host "No services defined in services.json." -ForegroundColor Yellow
    exit 0
}

Write-Host "Uninstalling $($all.Count) service(s)..." -ForegroundColor Cyan
Write-Host ""

foreach ($svc in $all) {
    $name = $svc.name
    Write-Host "› $name" -ForegroundColor Cyan

    # 停止服务
    $status = & $nssmExe status $name 2>$null
    if ($LASTEXITCODE -eq 0 -and $status -ne "SERVICE_STOPPED") {
        Write-Host "  Stopping..."
        & $nssmExe stop $name 2>&1 | Out-Null
        Start-Sleep -Seconds 1
    }

    # 移除服务
    Write-Host "  Removing..."
    & $nssmExe remove $name confirm 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  ✓ Removed" -ForegroundColor Green
    } else {
        Write-Host "  ✗ Remove failed (may already be removed)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done. All services uninstalled." -ForegroundColor Green
