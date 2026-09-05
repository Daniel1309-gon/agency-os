[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerIp,
  [Parameter(Mandatory = $true)][string]$StationIpCidr,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Este bundle solo admite Windows.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute PowerShell como Administrador bajo el usuario dedicado de la estación.'
}
if ($identity.IsSystem -or -not $env:USERPROFILE) { throw 'No ejecute el instalador como SYSTEM; use el usuario dedicado de Chrome.' }

$serverAddress = $null
if (-not [Net.IPAddress]::TryParse($ServerIp, [ref]$serverAddress) -or $serverAddress.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'ServerIp debe ser una dirección IPv4.'
}
if ($StationIpCidr -notmatch '^([^/]+)/32$') { throw 'StationIpCidr debe ser una IPv4 /32.' }
$stationAddress = $Matches[1]
$parsedStation = $null
if (-not [Net.IPAddress]::TryParse($stationAddress, [ref]$parsedStation) -or $parsedStation.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) {
  throw 'StationIpCidr debe ser una IPv4 /32.'
}
$localAddresses = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | Select-Object -ExpandProperty IPAddress)
if ($stationAddress -notin $localAddresses) { throw "La estación no tiene asignada la dirección declarada $stationAddress." }

$chromePaths = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
)
if (-not ($chromePaths | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1)) {
  throw 'Google Chrome no está instalado para la estación.'
}
foreach ($required in @('agency-os-helper.exe', 'agency-os-station-e2e-ca.crt', 'install-managed-policy.ps1')) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $required) -PathType Leaf)) { throw "Falta el artefacto $required en el bundle." }
}
if (-not (Test-NetConnection -ComputerName $ServerIp -Port 443 -InformationLevel Quiet)) {
  throw "No hay conectividad TCP 443 con el host Docker $ServerIp."
}
Write-Output "Preflight correcto para el usuario dedicado $($identity.Name), estación $StationIpCidr y extensión $ExtensionId."

