[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [string]$ApiBaseUrl = 'https://erp.globalcompany.company/api/v1',
  [string]$WebOrigin = 'https://erp.globalcompany.company',
  [string]$IsccPath = ''
)

# Compila el instalador de estacion (requiere Inno Setup 6).
#   winget install JRSoftware.InnoSetup
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

$helper = Join-Path $ProjectRoot 'local-helper\build\agency-os-helper.exe'
if (-not (Test-Path -LiteralPath $helper -PathType Leaf)) {
  throw "Falta $helper. Compile el helper con: cd local-helper; go build -o build/agency-os-helper.exe ./cmd/agency-os-helper"
}
$agentExe = Join-Path $PSScriptRoot 'dist\agency-os-agent\agency-os-agent.exe'
if (-not (Test-Path -LiteralPath $agentExe -PathType Leaf)) {
  throw 'Falta el agente compilado. Ejecute primero build-agent.ps1.'
}
if (-not $IsccPath) {
  $IsccPath = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}
if (-not $IsccPath) { throw 'No se encontro ISCC.exe. Instale Inno Setup 6 (winget install JRSoftware.InnoSetup).' }

Push-Location $PSScriptRoot
try {
  & $IsccPath "/DExtensionId=$ExtensionId" "/DApiBaseUrl=$ApiBaseUrl" "/DWebOrigin=$WebOrigin" (Join-Path $PSScriptRoot 'installer.iss')
  if ($LASTEXITCODE -ne 0) { throw "ISCC fallo con codigo $LASTEXITCODE" }
} finally {
  Pop-Location
}

$installer = Join-Path $PSScriptRoot 'dist-installer\agency-os-station-setup.exe'
$hash = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Instalador: $installer"
Write-Output "SHA-256: $hash"
Write-Output 'La huella del certificado se pasa al instalar: agency-os-station-setup.exe /CertSha256=<huella>'
