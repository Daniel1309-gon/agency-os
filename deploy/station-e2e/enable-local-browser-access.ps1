[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerIp,
  [string]$CaFile = '.local/station-e2e/pki/ca.crt'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalRoot = Join-Path $ProjectRoot '.local\station-e2e'
$StatePath = Join-Path $LocalRoot 'local-browser-access.json'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$BeginMarker = '# BEGIN Agency OS Docker Host Browser'
$EndMarker = '# END Agency OS Docker Host Browser'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script como Administrador.'
}

$parsedIp = $null
if (-not [Net.IPAddress]::TryParse($ServerIp, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'ServerIp debe ser una dirección IPv4.'
}
$localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress)
if ($ServerIp -notin $localAddresses) { throw "Esta PC no tiene asignada la dirección $ServerIp." }

$ResolvedCa = (Resolve-Path -LiteralPath (Join-Path $ProjectRoot $CaFile)).Path
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($ResolvedCa)
if ($certificate.HasPrivateKey) { throw 'El archivo de CA pública no debe contener una clave privada.' }
$basicConstraints = $certificate.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509BasicConstraintsExtension] } | Select-Object -First 1
if (-not $basicConstraints -or -not $basicConstraints.CertificateAuthority) { throw 'El certificado indicado no es una CA.' }

function Remove-AgencyHostsBlock([string]$Content) {
  $pattern = '(?ms)^\# BEGIN Agency OS Docker Host Browser\r?\n.*?^\# END Agency OS Docker Host Browser\r?\n?'
  return [Text.RegularExpressions.Regex]::Replace($Content, $pattern, '')
}

$HostsContent = Get-Content -LiteralPath $HostsPath -Raw
$HostsContent = (Remove-AgencyHostsBlock $HostsContent).TrimEnd("`r", "`n")
$HostsBlock = "$BeginMarker`r`n$ServerIp app.agency-os.test`r`n$ServerIp api.agency-os.test`r`n$EndMarker`r`n"
[IO.File]::WriteAllText($HostsPath, ($HostsContent + "`r`n" + $HostsBlock), [Text.UTF8Encoding]::new($false))

$CertificatePath = "Cert:\LocalMachine\Root\$($certificate.Thumbprint)"
$CaWasAlreadyTrusted = Test-Path -LiteralPath $CertificatePath
if (-not $CaWasAlreadyTrusted) {
  $ImportedCa = Import-Certificate -FilePath $ResolvedCa -CertStoreLocation 'Cert:\LocalMachine\Root'
  if (-not $ImportedCa.Thumbprint) { throw 'No se pudo instalar la CA pública.' }
}

$State = [ordered]@{
  schemaVersion = 1
  serverIp = $ServerIp
  caThumbprint = $certificate.Thumbprint
  caWasAlreadyTrusted = [bool]$CaWasAlreadyTrusted
  configuredAt = [DateTimeOffset]::UtcNow.ToString('o')
}
New-Item -ItemType Directory -Path $LocalRoot -Force | Out-Null
[IO.File]::WriteAllText($StatePath, (($State | ConvertTo-Json) + "`n"), [Text.UTF8Encoding]::new($false))

$null = Invoke-WebRequest -UseBasicParsing -Uri 'https://app.agency-os.test/' -TimeoutSec 15
$null = Invoke-WebRequest -UseBasicParsing -Uri 'https://api.agency-os.test/health/ready' -TimeoutSec 15
Write-Output 'Acceso local habilitado y HTTPS validado para app.agency-os.test y api.agency-os.test.'

