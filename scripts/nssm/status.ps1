<#
.SYNOPSIS
  查看所有 NSSM 服务的运行状态。

.DESCRIPTION
  读取 services.json，对每个服务调用 nssm status，
  输出表格。不需要管理员权限。
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 确保 nssm.exe 可用
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
    Write-Host "nssm.exe not found.  Install: choco install nssm" -ForegroundColor Yellow
    Write-Host "Or download from https://nssm.cc/download" -ForegroundColor Yellow
    Write-Host "Place it at: $nssmLocal or C:\Windows\System32\" -ForegroundColor Yellow
    exit 1
}

# 读取配置
$configPath = Join-Path $scriptDir "services.json"
if (-not (Test-Path $configPath)) {
    Write-Host "services.json not found." -ForegroundColor Red
    exit 1
}
$config = Get-Content $configPath -Raw | ConvertFrom-Json

if ($config.services.Count -eq 0) {
    Write-Host "No services defined." -ForegroundColor Yellow
    exit 0
}

# 输出表格
$nameW = 20
$statusW = 22
$startupW = 12

$header = ("{0,-$nameW} {1,-$statusW} {2,-$startupW}" -f "SERVICE", "STATUS", "STARTUP")
Write-Host $header -ForegroundColor Cyan
Write-Host ("-" * ($nameW + $statusW + $startupW + 2)) -ForegroundColor DarkGray

foreach ($svc in $config.services) {
    $name = $svc.name

    # 获取状态
    $status = & $nssmExe status $name 2>$null
    if ($LASTEXITCODE -ne 0) {
        $status = "NOT_INSTALLED"
    }

    # 获取启动类型
    $startup = "UNKNOWN"
    try {
        $wmiSvc = Get-Service -Name $name -ErrorAction Stop
        $startup = $wmiSvc.StartType.ToString()
    } catch {
        $startup = "N/A"
    }

    # 着色
    $color = "Red"
    if ($status -eq "SERVICE_RUNNING") {
        $color = "Green"
    }
    if ($status -eq "SERVICE_STOPPED") {
        $color = "Yellow"
    }
    if ($status -eq "SERVICE_START_PENDING") {
        $color = "Cyan"
    }
    if ($status -eq "NOT_INSTALLED") {
        $color = "DarkGray"
    }

    $line = ("{0,-$nameW} {1,-$statusW} {2,-$startupW}" -f $name, $status, $startup)
    Write-Host $line -ForegroundColor $color
}

Write-Host ""
Write-Host "Logs: Get-Content logs\<service>.log -Tail 50" -ForegroundColor DarkGray
Write-Host "GUI:  services.msc" -ForegroundColor DarkGray
