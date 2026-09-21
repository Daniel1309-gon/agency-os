[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CertificatePem,
  [Parameter(Mandatory = $true)][string]$PrivateKeyPem,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$CertificateName,
  [string]$Hostname = 'mtls-pilot.globalcompany.company',
  [string]$PfxPassword,
  [string]$OpenSslPath = 'openssl',
  [string]$LocalRoot = '.local/mtls-pilot'
)

# Importa el certificado de cliente del piloto en el almacén personal de la
# cuenta Windows actual y configura AutoSelectCertificateForUrls para el
# hostname exacto. No instala la CA ni el certificado como autoridad raíz.
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WorkRoot = Join-Path $ProjectRoot $LocalRoot
$PfxPath = Join-Path $WorkRoot "$CertificateName.pfx"
$ChromePolicyPath = 'HKCU:\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls'
$FilterPattern = "CN=$CertificateName"

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

if (-not (Test-Path -LiteralPath $CertificatePem -PathType Leaf)) { throw "No existe el certificado: $CertificatePem" }
if (-not (Test-Path -LiteralPath $PrivateKeyPem -PathType Leaf)) { throw "No existe la clave privada: $PrivateKeyPem" }
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

if (-not $PfxPassword) {
  $buffer = [byte[]]::new(24)
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
  $PfxPassword = [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')
}

# El PFX temporal queda bajo .local (fuera de Git) y se elimina al terminar.
& $OpenSslPath pkcs12 -export -inkey $PrivateKeyPem -in $CertificatePem -name $CertificateName -passout "pass:$PfxPassword" -out $PfxPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo convertir el certificado a PFX.' }

try {
  $secure = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
  $imported = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation 'Cert:\CurrentUser\My' -Password $secure
  if (-not $imported.Thumbprint) { throw 'No se pudo importar el PFX.' }

  # AutoSelectCertificateForUrls: solo el hostname del piloto, solo el
  # certificado de ensayo. No se toca ninguna otra política de Chrome.
  $entry = [ordered]@{ pattern = "https://$Hostname"; filter = [ordered]@{ SUBJECT = [ordered]@{ CN = $CertificateName } } }
  $entryJson = $entry | ConvertTo-Json -Compress -Depth 5
  if (-not (Test-Path -LiteralPath $ChromePolicyPath)) { New-Item -Path $ChromePolicyPath -Force | Out-Null }
  $existing = @((Get-Item -LiteralPath $ChromePolicyPath).Property | Where-Object { $_ -notmatch '^PS' })
  $nextIndex = 1
  while ($existing -contains "$nextIndex") { $nextIndex += 1 }
  New-ItemProperty -LiteralPath $ChromePolicyPath -Name "$nextIndex" -PropertyType String -Value $entryJson -Force | Out-Null

  Write-Output "Certificado importado en Cert:\CurrentUser\My."
  Write-Output "Thumbprint: $($imported.Thumbprint)"
  Write-Output "Política Chrome AutoSelectCertificateForUrls[$nextIndex] = $entryJson"
} finally {
  Remove-Item -LiteralPath $PfxPath -Force -ErrorAction SilentlyContinue
}
