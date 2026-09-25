[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,

  [Parameter(Mandatory = $true)]
  [string]$ApiBaseUrl,

  [Parameter(Mandatory = $true)]
  [string]$WebAppOrigin,

  [ValidatePattern('^[a-z0-9._-]+$')]
  [string]$NativeHostName = 'com.agencyos.helper'
)

$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Este instalador debe ejecutarse desde PowerShell como Administrador.'
}

function Assert-SecureUrl([string]$Value, [string]$Name, [string]$ExpectedPath) {
  try { $parsed = [Uri]$Value } catch { throw "$Name no es una URL válida." }
  if ($parsed.Scheme -ne 'https' -and $parsed.Host -ne 'localhost') {
    throw "$Name debe usar HTTPS fuera de localhost."
  }
  if ($parsed.UserInfo -or $parsed.Query -or $parsed.Fragment -or $parsed.AbsolutePath.TrimEnd('/') -ne $ExpectedPath.TrimEnd('/')) {
    throw "$Name debe ser una URL exacta sin credenciales, query ni fragmento."
  }
  return $parsed.AbsoluteUri.TrimEnd('/')
}

$normalizedApiBaseUrl = Assert-SecureUrl $ApiBaseUrl 'ApiBaseUrl' '/api/v1'
$normalizedWebAppOrigin = Assert-SecureUrl $WebAppOrigin 'WebAppOrigin' '/'

$policyPath = "HKLM:\Software\Policies\Google\Chrome\3rdparty\Extensions\$ExtensionId\policy"
New-Item -Path $policyPath -Force | Out-Null
New-ItemProperty -LiteralPath $policyPath -Name 'apiBaseUrl' -PropertyType String -Value $normalizedApiBaseUrl -Force | Out-Null
New-ItemProperty -LiteralPath $policyPath -Name 'webAppOrigin' -PropertyType String -Value $normalizedWebAppOrigin -Force | Out-Null
New-ItemProperty -LiteralPath $policyPath -Name 'nativeHostName' -PropertyType String -Value $NativeHostName -Force | Out-Null

# La identidad del equipo ya no es un token: es el certificado mTLS emitido
# para esa PC y registrado por huella en Agency OS. No hay secreto que instalar.
Write-Output "Política administrada instalada para la extensión $ExtensionId en HKLM."
Write-Output 'La identidad del equipo la aporta el certificado cliente; no se instala ningún token.'
