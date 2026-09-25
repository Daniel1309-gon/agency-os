[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CertificatePem,
  [Parameter(Mandatory = $true)][string]$PrivateKeyPem,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-zA-Z0-9._-]+$')][string]$CertificateName,
  [string]$OldCertificateName = 'agency-pilot-pc01',
  [string]$Hostname = 'mtls-pilot.globalcompany.company',
  [string]$OpenSslPath = 'openssl',
  [string]$LocalRoot = '.local/mtls-pilot'
)

# Cambia el certificado del piloto en Chrome/Windows: importa el nuevo,
# retira el anterior y su política, y deja solo la entrada nueva.
# Requiere elevación porque la clave de políticas de Chrome pertenece a
# Administradores/SYSTEM.
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$WorkRoot = Join-Path $ProjectRoot $LocalRoot
$PfxPath = Join-Path $WorkRoot "$CertificateName.pfx"
$ChromePolicyPath = 'HKCU:\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script como Administrador.'
}
if (-not (Test-Path -LiteralPath $CertificatePem -PathType Leaf)) { throw "No existe el certificado nuevo: $CertificatePem" }
if (-not (Test-Path -LiteralPath $PrivateKeyPem -PathType Leaf)) { throw "No existe la clave privada nueva: $PrivateKeyPem" }
New-Item -ItemType Directory -Path $WorkRoot -Force | Out-Null

$buffer = [byte[]]::new(24)
$generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
$PfxPassword = [Convert]::ToBase64String($buffer).Replace('+', '-').Replace('/', '_').TrimEnd('=')

& $OpenSslPath pkcs12 -export -inkey $PrivateKeyPem -in $CertificatePem -name $CertificateName -passout "pass:$PfxPassword" -out $PfxPath
if ($LASTEXITCODE -ne 0) { throw 'No se pudo convertir el certificado nuevo a PFX.' }

try {
  # 1) Importar el nuevo antes de retirar el anterior.
  $secure = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
  $imported = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation 'Cert:\CurrentUser\My' -Password $secure
  if (-not $imported.Thumbprint) { throw 'No se pudo importar el PFX nuevo.' }

  # 2) Retirar el certificado anterior del almacén personal.
  Get-ChildItem -Path 'Cert:\CurrentUser\My' | Where-Object { $_.Subject -match "CN=$OldCertificateName" } | ForEach-Object {
    Remove-Item -LiteralPath $_.PSPath -Force
  }

  # 3) Reescribir la política: solo el hostname del piloto, solo el certificado nuevo.
  if (-not (Test-Path -LiteralPath $ChromePolicyPath)) { New-Item -Path $ChromePolicyPath -Force | Out-Null }
  $properties = @((Get-Item -LiteralPath $ChromePolicyPath).Property | Where-Object { $_ -notmatch '^PS' })
  foreach ($name in $properties) {
    $value = (Get-ItemProperty -LiteralPath $ChromePolicyPath -Name $name).$name
    if ($value -like "*$Hostname*") { Remove-ItemProperty -LiteralPath $ChromePolicyPath -Name $name -Force }
  }
  $entry = [ordered]@{ pattern = "https://$Hostname"; filter = [ordered]@{ SUBJECT = [ordered]@{ CN = $CertificateName } } }
  $entryJson = $entry | ConvertTo-Json -Compress -Depth 5
  $remaining = @((Get-Item -LiteralPath $ChromePolicyPath).Property | Where-Object { $_ -notmatch '^PS' })
  $nextIndex = 1
  while ($remaining -contains "$nextIndex") { $nextIndex += 1 }
  New-ItemProperty -LiteralPath $ChromePolicyPath -Name "$nextIndex" -PropertyType String -Value $entryJson -Force | Out-Null

  Write-Output "Certificado activo: $($imported.Thumbprint) (CN=$CertificateName)."
  Write-Output "Política Chrome: AutoSelectCertificateForUrls[$nextIndex] = $entryJson"
  Write-Output "Certificado anterior ($OldCertificateName) retirado."
} finally {
  Remove-Item -LiteralPath $PfxPath -Force -ErrorAction SilentlyContinue
}
