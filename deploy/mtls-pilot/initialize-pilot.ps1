[CmdletBinding()]
param(
  [string]$LocalRoot = '.local/mtls-pilot',
  [string]$ExtensionId = 'fcniigapdfcoigmnkhkcgmhlhjdledbo',
  [switch]$RotateSecrets
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalRootPath = Join-Path $ProjectRoot $LocalRoot
$SecretsRoot = Join-Path $LocalRootPath 'secrets'
$EnvPath = Join-Path $LocalRootPath 'pilot.env'

function New-RandomValue([int]$Bytes = 48) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

New-Item -ItemType Directory -Path $SecretsRoot -Force | Out-Null

$SecretNames = @(
  'postgres_owner_password', 'database_owner_url', 'database_app_url', 'database_runtime_password',
  'jwt_secret', 'vault_kek', 'bootstrap_admin_password', 'demo_user_password'
)
$ExistingSecrets = @($SecretNames | Where-Object { Test-Path -LiteralPath (Join-Path $SecretsRoot $_) -PathType Leaf })
if ($RotateSecrets) { $ExistingSecrets = @() }
elseif ($ExistingSecrets.Count -gt 0 -and $ExistingSecrets.Count -ne $SecretNames.Count) {
  throw 'El directorio de secretos está incompleto. Use -RotateSecrets solo para reemplazar el conjunto completo.'
}

if ($ExistingSecrets.Count -eq 0) {
  $OwnerPassword = New-RandomValue
  $RuntimePassword = New-RandomValue
  $SecretValues = [ordered]@{
    postgres_owner_password = $OwnerPassword
    database_owner_url = "postgresql://agency:$OwnerPassword@postgres:5432/agency_os"
    database_app_url = "postgresql://agency_runtime:$RuntimePassword@postgres:5432/agency_os"
    database_runtime_password = $RuntimePassword
    jwt_secret = New-RandomValue
    vault_kek = New-RandomValue
    bootstrap_admin_password = New-RandomValue
    demo_user_password = New-RandomValue
  }
  foreach ($entry in $SecretValues.GetEnumerator()) {
    Write-Utf8NoBom (Join-Path $SecretsRoot $entry.Key) $entry.Value
  }
}

# El token del túnel lo entrega Cloudflare al crear el túnel administrado.
$TunnelTokenPath = Join-Path $SecretsRoot 'cloudflared_token'
if (-not (Test-Path -LiteralPath $TunnelTokenPath -PathType Leaf)) {
  Write-Utf8NoBom $TunnelTokenPath 'REPLACE_WITH_CLOUDFLARE_TUNNEL_TOKEN'
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
& icacls.exe $LocalRootPath /inheritance:r /grant:r "$($identity.Name):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir las ACL del piloto.' }

$ExistingEnv = if (Test-Path -LiteralPath $EnvPath -PathType Leaf) { Get-Content -LiteralPath $EnvPath } else { @() }
function ExistingValue([string]$Name) {
  $line = $ExistingEnv | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if ($line) { return $line.Substring($Name.Length + 1).Trim() }
  return ''
}

$PilotIps = ExistingValue 'PILOT_IP_CIDRS'
$AllowlistExpiry = ExistingValue 'PILOT_ALLOWLIST_EXPIRES_AT'
$ConfiguredExtension = ExistingValue 'VITE_EXTENSION_ID'
if (-not $ConfiguredExtension) { $ConfiguredExtension = $ExtensionId }
if (-not $AllowlistExpiry) { $AllowlistExpiry = [DateTimeOffset]::UtcNow.AddDays(14).ToString('o') }

$EnvironmentLines = @(
  'PILOT_SECRETS_DIR=.local/mtls-pilot/secrets',
  'PILOT_AGENT_DIR=.local/mtls-pilot/agent',
  "VITE_EXTENSION_ID=$ConfiguredExtension",
  "PILOT_IP_CIDRS=$PilotIps",
  "PILOT_ALLOWLIST_EXPIRES_AT=$AllowlistExpiry"
)
Write-Utf8NoBom $EnvPath (($EnvironmentLines -join "`n") + "`n")

Write-Output "Piloto inicializado en $LocalRootPath."
if (-not $PilotIps) {
  Write-Output 'Pendiente: defina PILOT_IP_CIDRS en .local/mtls-pilot/pilot.env con las IP públicas de ensayo antes de levantar el stack.'
}
Write-Output 'Siguiente paso: reemplace el token del túnel y ejecute pnpm stack:mtls:config; pnpm stack:mtls:build; pnpm stack:mtls:up'
