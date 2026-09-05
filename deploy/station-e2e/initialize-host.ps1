[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$ServerIp,

  [Parameter(Mandatory = $true)]
  [string]$StationIpCidr,

  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [string]$ExtensionPemFile = 'extension/chrome-extension.pem',
  [string]$OpenSslPath = 'openssl',
  [switch]$RotateSecrets
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalRoot = Join-Path $ProjectRoot '.local\station-e2e'
$SecretsRoot = Join-Path $LocalRoot 'secrets'
$PkiRoot = Join-Path $LocalRoot 'pki'
$ExtensionRoot = Join-Path $LocalRoot 'extension-public'
$EnvPath = Join-Path $LocalRoot 'station.env'
$FirewallName = 'Agency OS Station E2E HTTPS'

function Assert-IPv4([string]$Value, [string]$Name) {
  $parsed = $null
  if (-not [Net.IPAddress]::TryParse($Value, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
    throw "$Name debe ser una dirección IPv4."
  }
}

Assert-IPv4 $ServerIp 'ServerIp'
if ($StationIpCidr -notmatch '^([^/]+)/32$') { throw 'StationIpCidr debe ser un único host IPv4 con prefijo /32.' }
$StationAddress = $Matches[1]
Assert-IPv4 $StationAddress 'StationIpCidr'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'La inicialización del host debe ejecutarse como Administrador para configurar el firewall.'
}

New-Item -ItemType Directory -Path $SecretsRoot, $PkiRoot, $ExtensionRoot -Force | Out-Null

# Create()/GetBytes() works on both Windows PowerShell 5.1 (.NET Framework) and
# PowerShell 7 (.NET). RandomNumberGenerator::Fill exists only on the latter.
function New-RandomValue([int]$Bytes = 48) {
  $buffer = [byte[]]::new($Bytes)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

$SecretNames = @(
  'postgres_owner_password', 'database_owner_url', 'database_app_url', 'database_worker_url',
  'database_runtime_password', 'database_worker_password', 'jwt_secret', 'vault_kek',
  'bootstrap_admin_password', 'demo_user_password', 'rocketchat_token', 'rocketchat_user_id'
)
$ExistingSecrets = @($SecretNames | Where-Object { Test-Path -LiteralPath (Join-Path $SecretsRoot $_) -PathType Leaf })
if ($RotateSecrets) {
  $ExistingSecrets = @()
} elseif ($ExistingSecrets.Count -gt 0 -and $ExistingSecrets.Count -ne $SecretNames.Count) {
  throw 'El directorio de secretos está incompleto. Use -RotateSecrets solamente si desea reemplazar el conjunto completo.'
}

if ($ExistingSecrets.Count -eq 0) {
  $OwnerPassword = New-RandomValue
  $RuntimePassword = New-RandomValue
  $WorkerPassword = New-RandomValue
  $SecretValues = [ordered]@{
    postgres_owner_password = $OwnerPassword
    database_owner_url = "postgresql://agency:$OwnerPassword@postgres:5432/agency_os"
    database_app_url = "postgresql://agency_runtime:$RuntimePassword@postgres:5432/agency_os"
    database_worker_url = "postgresql://agency_worker_runtime:$WorkerPassword@postgres:5432/agency_os"
    database_runtime_password = $RuntimePassword
    database_worker_password = $WorkerPassword
    jwt_secret = New-RandomValue
    vault_kek = New-RandomValue
    bootstrap_admin_password = New-RandomValue
    demo_user_password = New-RandomValue
    rocketchat_token = 'NOT_CONFIGURED_WORKER_DISABLED'
    rocketchat_user_id = 'NOT_CONFIGURED_WORKER_DISABLED'
  }
  foreach ($entry in $SecretValues.GetEnumerator()) {
    Write-Utf8NoBom (Join-Path $SecretsRoot $entry.Key) $entry.Value
  }
}

# Restrict private local deployment material to the current user, SYSTEM and Administrators.
& icacls.exe $LocalRoot /inheritance:r /grant:r "$($identity.Name):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir las ACL de .local\station-e2e.' }

$CaKey = Join-Path $PkiRoot 'ca.key'
$CaCertificate = Join-Path $PkiRoot 'ca.crt'
$ServerKey = Join-Path $PkiRoot 'server.key'
$ServerCertificate = Join-Path $PkiRoot 'server.crt'
$CertificateFiles = @($CaKey, $CaCertificate, $ServerKey, $ServerCertificate)
$ExistingCertificates = @($CertificateFiles | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf })
if ($ExistingCertificates.Count -gt 0 -and $ExistingCertificates.Count -ne $CertificateFiles.Count) {
  throw 'El conjunto PKI está incompleto; no se reemplazará parcialmente.'
}

function Invoke-OpenSsl([string[]]$Arguments) {
  & $OpenSslPath @Arguments
  if ($LASTEXITCODE -ne 0) { throw "OpenSSL falló al ejecutar: $($Arguments[0])" }
}

if ($ExistingCertificates.Count -eq 0) {
  $OpenSslConfig = Join-Path $PkiRoot 'server-openssl.cnf'
  $CertificateRequest = Join-Path $PkiRoot 'server.csr'
  $SerialFile = Join-Path $PkiRoot 'ca.srl'
  $Config = @"
[req]
prompt = no
distinguished_name = dn
req_extensions = req_ext
[dn]
CN = app.agency-os.test
[req_ext]
subjectAltName = @alt_names
[alt_names]
DNS.1 = app.agency-os.test
DNS.2 = api.agency-os.test
[v3_ext]
authorityKeyIdentifier = keyid,issuer
basicConstraints = CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names
"@
  Write-Utf8NoBom $OpenSslConfig $Config
  Invoke-OpenSsl @('genrsa', '-out', $CaKey, '4096')
  Invoke-OpenSsl @('req', '-x509', '-new', '-sha256', '-days', '30', '-key', $CaKey, '-subj', '/CN=Agency OS Station E2E CA', '-out', $CaCertificate)
  Invoke-OpenSsl @('genrsa', '-out', $ServerKey, '2048')
  Invoke-OpenSsl @('req', '-new', '-key', $ServerKey, '-out', $CertificateRequest, '-config', $OpenSslConfig)
  Invoke-OpenSsl @('x509', '-req', '-in', $CertificateRequest, '-CA', $CaCertificate, '-CAkey', $CaKey, '-CAcreateserial', '-out', $ServerCertificate, '-days', '14', '-sha256', '-extfile', $OpenSslConfig, '-extensions', 'v3_ext')
  Remove-Item -LiteralPath $CertificateRequest, $SerialFile -Force -ErrorAction SilentlyContinue
}
Invoke-OpenSsl @('verify', '-CAfile', $CaCertificate, $ServerCertificate)

$RelativeLocal = '.local/station-e2e'
$EnvironmentLines = @(
  "SERVER_IP=$ServerIp",
  "STATION_IP_CIDR=$StationIpCidr",
  "EXTENSION_ID=$ExtensionId",
  "VITE_EXTENSION_ID=$ExtensionId",
  'STATION_E2E_API_BASE_URL=https://api.agency-os.test/api/v1',
  "STATION_E2E_SECRETS_DIR=$RelativeLocal/secrets",
  "STATION_E2E_PKI_DIR=$RelativeLocal/pki",
  "STATION_E2E_EXTENSION_DIR=$RelativeLocal/extension-public",
  "STATION_E2E_CA_FILE=$RelativeLocal/pki/ca.crt",
  "STATION_E2E_ADMIN_PASSWORD_FILE=$RelativeLocal/secrets/bootstrap_admin_password"
)
Write-Utf8NoBom $EnvPath (($EnvironmentLines -join "`n") + "`n")

$ResolvedPem = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot $ExtensionPemFile)).Path
$env:EXTENSION_ID = $ExtensionId
$env:VITE_EXTENSION_ID = $ExtensionId
$env:EXTENSION_PEM_FILE = $ResolvedPem
$env:STATION_E2E_LOCAL_DIR = $LocalRoot
& node (Join-Path $ProjectRoot 'extension\scripts\package-managed-extension.mjs')
if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el CRX administrado.' }

$ExistingRule = Get-NetFirewallRule -DisplayName $FirewallName -ErrorAction SilentlyContinue
if ($ExistingRule) { $ExistingRule | Remove-NetFirewallRule }
New-NetFirewallRule -DisplayName $FirewallName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 443 -RemoteAddress $StationAddress -Profile Any | Out-Null

Write-Output "Host E2E inicializado para $StationIpCidr; secretos y claves privadas permanecen bajo .local."
Write-Output 'Siguiente paso: pnpm stack:e2e:config; pnpm stack:e2e:build; pnpm stack:e2e:up; pnpm stack:e2e:provision'
