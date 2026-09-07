[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,
  [ValidateRange(1, 2147483647)]
  [int]$ValueName = 1001
)

$ErrorActionPreference = 'Stop'
$policyPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
$value = "$ExtensionId;https://clients2.google.com/service/update2/crx"
$existing = $null
if (Test-Path -LiteralPath $policyPath) {
  $properties = Get-ItemProperty -LiteralPath $policyPath
  $existing = $properties.PSObject.Properties[[string]$ValueName].Value
}
if ($existing -and ($existing -split ';')[0] -ne $ExtensionId) {
  throw "La entrada $ValueName pertenece a otra extensión. Elija otro ValueName libre."
}

if ($PSCmdlet.ShouldProcess("$policyPath\$ValueName", "Instalar desde Chrome Web Store: $value")) {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Ejecute este instalador en PowerShell como Administrador, en la estación de prueba.'
  }
  New-Item -Path $policyPath -Force | Out-Null
  New-ItemProperty -LiteralPath $policyPath -Name ([string]$ValueName) -PropertyType String -Value $value -Force | Out-Null
  if ((Get-ItemProperty -LiteralPath $policyPath).([string]$ValueName) -ne $value) {
    throw 'No se pudo verificar la política de instalación.'
  }
  Write-Output "Política instalada en la entrada $ValueName. Recargue chrome://policy y compruebe la extensión en cada perfil."
}
