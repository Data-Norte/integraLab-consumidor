param(
  [switch]$InstallDeps,
  [switch]$Build,
  [switch]$Background,
  [ValidateSet('dist', 'dev')]
  [string]$Mode = 'dist',
  [string]$Port = '3001',
  [string]$NodeEnv = 'production',
  [string]$AppEnv = 'prd',
  [string]$LogDir = ''
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runtimeDir = if ($LogDir) { $LogDir } else { Join-Path $repoRoot '.runtime' }
if (-not (Test-Path $runtimeDir)) {
  New-Item -ItemType Directory -Path $runtimeDir | Out-Null
}

if ($InstallDeps) {
  Push-Location $repoRoot
  try {
    npm.cmd ci --include=dev
  } finally {
    Pop-Location
  }
}

if ($Build -and $Mode -eq 'dist') {
  Push-Location $repoRoot
  try {
    npm.cmd run build
  } finally {
    Pop-Location
  }
}

$cmdParts = @(
  "set ""PORT=$Port""",
  "set ""NODE_ENV=$NodeEnv""",
  "set ""APP_ENV=$AppEnv"""
)

$cmdParts += if ($Mode -eq 'dev') { 'npm.cmd run dev' } else { 'npm.cmd run start' }
$cmdLine = ($cmdParts -join ' && ')

if ($Background) {
  $stdout = Join-Path $runtimeDir 'consumer-out.log'
  $stderr = Join-Path $runtimeDir 'consumer-err.log'
  $process = Start-Process cmd.exe `
    -ArgumentList '/c', $cmdLine `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru

  Write-Host "Consumidor iniciado em background. PID: $($process.Id)"
  Write-Host "Modo: $Mode"
  Write-Host "Logs: $stdout"
  return
}

Push-Location $repoRoot
try {
  cmd.exe /c $cmdLine
} finally {
  Pop-Location
}
