[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory = $true)][string]$ApiBaseUrl,
  [Parameter(Mandatory = $true)][string]$WebOrigin,
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9a-f]{64}$')][string]$CertSha256,
  [int]$AgentPort = 45831,
  [string]$NativeHostName = 'com.agencyos.helper',
  [string]$ExtensionUpdateUrl = 'https://clients2.google.com/service/update2/crx'
)

# Alta de una estacion Windows (plan 2026-09-20, fase D2). Se ejecuta elevada y
# como el usuario compartido de la PC; escribe solo lo suyo y no borra politicas
# ni certificados ajenos. No imprime secretos (no hay ninguno).
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'La instalacion de la estacion requiere elevacion.'
}

function Assert-Https([string]$Value, [string]$Name) {
  $parsed = [Uri]$Value
  if ($parsed.Scheme -ne 'https' -and $parsed.Host -notin @('localhost', '127.0.0.1')) {
    throw "$Name debe usar HTTPS fuera de localhost."
  }
  if ($parsed.UserInfo) { throw "$Name no puede llevar credenciales." }
  return $parsed.AbsoluteUri.TrimEnd('/')
}

$apiBaseUrl = Assert-Https $ApiBaseUrl 'ApiBaseUrl'
$webOrigin = Assert-Https $WebOrigin 'WebOrigin'
if ($apiBaseUrl -notmatch '/api/v1$') { throw 'ApiBaseUrl debe terminar en /api/v1.' }
$webHost = ([Uri]$webOrigin).Host

$dataRoot = Join-Path $env:ProgramData 'AgencyOS'
$helperExe = Join-Path $InstallDir 'agency-os-helper.exe'
$agentExe = Join-Path $InstallDir 'agent\agency-os-agent.exe'
foreach ($required in @($helperExe, $agentExe)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Falta $required en el paquete de instalacion." }
}

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
& icacls.exe $dataRoot /inheritance:r /grant:r "$($identity.Name):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir las ACL de ProgramData\AgencyOS.' }

# 1. Configuracion del agente: la huella del certificado la aporta el instalador
#    porque cada PC tiene el suyo. Sin argumentos de linea de comandos.
$agentConfig = [ordered]@{
  apiBaseUrl  = $apiBaseUrl
  webOrigin   = $webOrigin
  certSha256  = $CertSha256
  certStore   = 'CURRENT_USER'
  port        = $AgentPort
  slotRoot    = (Join-Path $dataRoot 'slots')
  logFile     = (Join-Path $dataRoot 'agent.log')
} | ConvertTo-Json -Depth 3
[IO.File]::WriteAllText((Join-Path $dataRoot 'agent.json'), $agentConfig + "`n", [Text.UTF8Encoding]::new($false))

# 2. Helper de Native Messaging: manifiesto + registro por usuario (Chrome corre
#    como la cuenta compartida de la PC).
$manifest = [ordered]@{
  name            = $NativeHostName
  description     = 'Agency OS Native Messaging helper'
  path            = $helperExe
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 3
$manifestPath = Join-Path $InstallDir "$NativeHostName.json"
[IO.File]::WriteAllText($manifestPath, $manifest + "`n", [Text.UTF8Encoding]::new($false))
$hostKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
New-Item -Path $hostKey -Force | Out-Null
Set-ItemProperty -LiteralPath $hostKey -Name '(default)' -Value $manifestPath

# 3. Politicas de Chrome (equipo): extension forzada y seleccion automatica del
#    certificado SOLO para el dominio de Agency OS. No se tocan otras entradas.
$forcelistPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
New-Item -Path $forcelistPath -Force | Out-Null
$forcelistName = '1001'
$existing = (Get-ItemProperty -LiteralPath $forcelistPath -Name $forcelistName -ErrorAction SilentlyContinue).$forcelistName
$forcelistValue = "$ExtensionId;$ExtensionUpdateUrl"
if ($existing -and $existing -ne $forcelistValue) { throw "La entrada Enterprise $forcelistName ya pertenece a otra extension." }
New-ItemProperty -LiteralPath $forcelistPath -Name $forcelistName -PropertyType String -Value $forcelistValue -Force | Out-Null

$autoSelectPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\AutoSelectCertificateForUrls'
New-Item -Path $autoSelectPath -Force | Out-Null
# Entrada propia en el primer indice libre (no se pisa la de otro programa) y
# con filtro por CN del certificado de esta PC, para no ofrecer certificados
# ajenos. El nombre usado queda en chrome-policy.json para que la baja retire
# solo esta entrada y solo si su valor sigue siendo el nuestro.
$sha256 = [Security.Cryptography.SHA256]::Create()
$cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object {
  (($sha256.ComputeHash($_.RawData) | ForEach-Object { $_.ToString('x2') }) -join '') -eq $CertSha256
} | Select-Object -First 1
if (-not $cert) {
  throw "No esta en Cert:\CurrentUser\My el certificado con huella $CertSha256; importelo antes de instalar (RUNBOOK seccion 1)."
}
$certCN = [string]$cert.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
if (-not $certCN) { throw 'No se pudo leer el CN del certificado de la PC.' }
$autoSelectValue = (@{ pattern = "https://$webHost"; filter = @{ SUBJECT = @{ CN = $certCN } } } | ConvertTo-Json -Compress -Depth 5)
$existingNames = @((Get-Item -LiteralPath $autoSelectPath).Property | Where-Object { $_ -notmatch '^PS' })
$autoSelectName = $null
foreach ($name in $existingNames) {
  if ((Get-ItemProperty -LiteralPath $autoSelectPath -Name $name).$name -eq $autoSelectValue) { $autoSelectName = $name; break }
}
if (-not $autoSelectName) {
  $nextIndex = 1
  while ($existingNames -contains "$nextIndex") { $nextIndex += 1 }
  $autoSelectName = "$nextIndex"
}
New-ItemProperty -LiteralPath $autoSelectPath -Name $autoSelectName -PropertyType String -Value $autoSelectValue -Force | Out-Null
$policyState = @{ autoSelectName = $autoSelectName; autoSelectValue = $autoSelectValue } | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $dataRoot 'chrome-policy.json'), $policyState + "`n", [Text.UTF8Encoding]::new($false))

# 4. Arranque automatico al iniciar sesion, sin consola, para la cuenta compartida.
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
New-ItemProperty -LiteralPath $runKey -Name 'AgencyOSAgent' -PropertyType String -Value "`"$agentExe`"" -Force | Out-Null

Write-Output "Estacion instalada. Agente en $agentExe; huella $CertSha256 registrada en la configuracion local."
Write-Output 'Siguiente paso: registrar esa huella en Agency OS (enrolamiento) y validar chrome://policy.'
