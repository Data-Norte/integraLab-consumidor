<#
.SYNOPSIS
Deploy do integraLab-consumidor para o servidor Xandy via SSH + PM2.

.DESCRIPTION
Por padrao envia o HEAD atual do repositorio. Quando -UseWorkingTree e informado,
o script monta um pacote com o HEAD mais os arquivos modificados localmente.
No servidor, executa npm ci, npm run build, npm prune --omit=dev, preserva .env
e .runtime e reinicia ou cria o processo PM2 do consumidor.

.EXAMPLE
$env:DEPLOY_SSH_PASSWORD='sua-senha'
powershell -ExecutionPolicy Bypass -File ".\deploy sh\deploy-integralab-consumidor-xandy.ps1" -DryRun

.EXAMPLE
$env:DEPLOY_SSH_PASSWORD='sua-senha'
powershell -ExecutionPolicy Bypass -File ".\deploy sh\deploy-integralab-consumidor-xandy.ps1" -UseWorkingTree
#>

param(
  [string]$TargetHost = '77.37.43.92',
  [string]$TargetUser = 'root',
  [string]$Password = $env:DEPLOY_SSH_PASSWORD,
  [string]$RemoteDir = '/opt/xandy/integraLab-consumidor',
  [string]$Pm2App = 'app-consumer-3001',
  [switch]$UseWorkingTree,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

function Get-RequiredCommand([string]$Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Comando obrigatorio nao encontrado: $Name"
  }
  return $command.Source
}

function Invoke-Local([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory) {
  $stdoutPath = Join-Path $env:TEMP ("deploy-stdout-" + [guid]::NewGuid().ToString('N') + '.log')
  $stderrPath = Join-Path $env:TEMP ("deploy-stderr-" + [guid]::NewGuid().ToString('N') + '.log')

  try {
    $process = Start-Process `
      -FilePath $FilePath `
      -ArgumentList $Arguments `
      -WorkingDirectory $WorkingDirectory `
      -NoNewWindow `
      -Wait `
      -PassThru `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $stdout = if (Test-Path $stdoutPath) { Get-Content $stdoutPath -Raw } else { '' }
    $stderr = if (Test-Path $stderrPath) { Get-Content $stderrPath -Raw } else { '' }
    $output = @($stdout, $stderr) | Where-Object { $_ -and $_.Trim() }
    $exitCode = $process.ExitCode
  } finally {
    if (Test-Path $stdoutPath) {
      Remove-Item $stdoutPath -Force
    }
    if (Test-Path $stderrPath) {
      Remove-Item $stderrPath -Force
    }
  }

  if ($exitCode -ne 0) {
    throw "Falha ao executar '$FilePath $($Arguments -join ' ')':`n$output"
  }

  return ($output -join [Environment]::NewLine).Trim()
}

function Invoke-Remote([string]$PlinkPath, [string]$RemoteHost, [string]$RemoteUser, [string]$Secret, [string]$CommandText) {
  $arguments = @(
    '-ssh',
    '-batch',
    '-pw',
    $Secret,
    "$RemoteUser@$RemoteHost",
    $CommandText
  )

  return Invoke-Local $PlinkPath $arguments $repoRoot
}

function Get-WorkingTreeOverlayFiles([string]$GitPath, [string]$WorkingDirectory) {
  $statusOutput = Invoke-Local $GitPath @('status', '--porcelain', '--untracked-files=no') $WorkingDirectory
  if (-not $statusOutput) {
    return @()
  }

  return @(
    $statusOutput -split "\r?\n" |
      Where-Object { $_.Length -ge 4 } |
      ForEach-Object { $_.Substring(3).Trim().Trim('"') } |
      Where-Object { $_ -and $_ -notmatch ' -> ' }
  )
}

function Resolve-Password() {
  if ($Password) {
    return $Password
  }

  $securePassword = Read-Host 'Senha SSH' -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)

  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path $scriptDir -Parent
$resolvedPassword = Resolve-Password

$gitPath = Get-RequiredCommand 'git'
$tarPath = Get-RequiredCommand 'tar.exe'
$plinkPath = Get-RequiredCommand 'plink.exe'
$pscpPath = Get-RequiredCommand 'pscp.exe'

$headCommit = Invoke-Local $gitPath @('rev-parse', '--short', 'HEAD') $repoRoot
$dirtyStatus = Invoke-Local $gitPath @('status', '--short') $repoRoot

if ($dirtyStatus) {
  Write-Warning 'Existem mudancas locais nao commitadas. O deploy usa somente o HEAD atual.'
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archiveName = "integralab-consumidor-$headCommit-$timestamp.tar.gz"
$archivePath = Join-Path $env:TEMP $archiveName
$headArchivePath = Join-Path $env:TEMP ("integralab-consumidor-head-$headCommit-$timestamp.tar.gz")
$localStageDir = Join-Path $env:TEMP ("integralab-consumidor-local-stage-$headCommit-$timestamp")
$remoteArchivePath = "/tmp/$archiveName"
$stageDir = "/tmp/integralab-consumidor-stage-$headCommit-$timestamp"

if (Test-Path $archivePath) {
  Remove-Item $archivePath -Force
}

if (Test-Path $headArchivePath) {
  Remove-Item $headArchivePath -Force
}

if (Test-Path $localStageDir) {
  Remove-Item $localStageDir -Recurse -Force
}

try {
  if ($UseWorkingTree) {
    Invoke-Local $gitPath @('archive', '--format=tar.gz', "--output=$headArchivePath", 'HEAD') $repoRoot | Out-Null

    New-Item -ItemType Directory -Path $localStageDir | Out-Null
    Invoke-Local $tarPath @('-xzf', $headArchivePath, '-C', $localStageDir) $repoRoot | Out-Null

    foreach ($relativePath in Get-WorkingTreeOverlayFiles $gitPath $repoRoot) {
      $sourcePath = Join-Path $repoRoot $relativePath
      $destinationPath = Join-Path $localStageDir $relativePath
      $destinationDir = Split-Path -Parent $destinationPath

      if (-not (Test-Path $sourcePath)) {
        continue
      }

      if ($destinationDir -and -not (Test-Path $destinationDir)) {
        New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
      }

      Copy-Item -Path $sourcePath -Destination $destinationPath -Force
    }

    Invoke-Local $tarPath @('-czf', $archivePath, '-C', $localStageDir, '.') $repoRoot | Out-Null
  } else {
    Invoke-Local $gitPath @('archive', '--format=tar.gz', "--output=$archivePath", 'HEAD') $repoRoot | Out-Null
  }

  if (-not (Test-Path $archivePath)) {
    throw "Arquivo de deploy nao foi gerado: $archivePath"
  }

  $preflight = @"
set -e
mkdir -p '$RemoteDir'
command -v npm >/dev/null 2>&1
command -v pm2 >/dev/null 2>&1
test -f '$RemoteDir/.env'
echo PRECHECK_OK
"@

  $preflightResult = Invoke-Remote $plinkPath $TargetHost $TargetUser $resolvedPassword $preflight
  if ($preflightResult -notmatch 'PRECHECK_OK') {
    throw 'Precheck remoto nao confirmou o ambiente.'
  }

  if ($DryRun) {
    Write-Output "Dry-run concluido. Commit: $headCommit"
    Write-Output "Destino remoto: ${TargetUser}@${TargetHost}:$RemoteDir"
    Write-Output "Processo PM2: $Pm2App"
    return
  }

  Invoke-Local $pscpPath @(
    '-batch',
    '-pw',
    $resolvedPassword,
    $archivePath,
    "$TargetUser@$TargetHost`:$remoteArchivePath"
  ) $repoRoot | Out-Null

  $remoteDeploy = @"
set -eu
REMOTE_DIR='$RemoteDir'
REMOTE_ARCHIVE='$remoteArchivePath'
STAGE_DIR='$stageDir'
PM2_APP='$Pm2App'

rm -rf "`$STAGE_DIR"
mkdir -p "`$STAGE_DIR"
tar -xzf "`$REMOTE_ARCHIVE" -C "`$STAGE_DIR"

cd "`$STAGE_DIR"
npm ci
npm run build
npm prune --omit=dev

test -f "`$REMOTE_DIR/.env"
mkdir -p "`$REMOTE_DIR/.runtime"

find "`$REMOTE_DIR" -mindepth 1 -maxdepth 1 ! -name '.env' ! -name '.git' ! -name '.runtime' -exec rm -rf {} +
cp -a "`$STAGE_DIR"/. "`$REMOTE_DIR"/

cd "`$REMOTE_DIR"
if pm2 describe "`$PM2_APP" >/dev/null 2>&1; then
  pm2 restart "`$PM2_APP" --update-env
else
  pm2 start dist/server.js --name "`$PM2_APP"
fi
pm2 save

rm -rf "`$STAGE_DIR" "`$REMOTE_ARCHIVE"

echo DEPLOY_OK
pm2 describe "`$PM2_APP" | sed -n '1,50p'
"@

  $deployResult = Invoke-Remote $plinkPath $TargetHost $TargetUser $resolvedPassword $remoteDeploy
  if ($deployResult -notmatch 'DEPLOY_OK') {
    throw "Deploy remoto nao confirmou sucesso:`n$deployResult"
  }

  Write-Output $deployResult
} finally {
  if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
  }

  if (Test-Path $headArchivePath) {
    Remove-Item $headArchivePath -Force
  }

  if (Test-Path $localStageDir) {
    Remove-Item $localStageDir -Recurse -Force
  }
}
