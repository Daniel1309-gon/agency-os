[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$StatePath = Join-Path $ProjectRoot '.local\station-e2e\local-browser-access.json'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Ejecute este script como Administrador.'
}
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { throw 'No existe estado de acceso local para retirar.' }
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
if ($State.schemaVersion -ne 1 -or $State.caThumbprint -notmatch '^[0-9A-Fa-f]{40}$') {
  throw 'El estado de acceso local no es válido; no se modificará el sistema.'
}

$HostsContent = Get-Content -LiteralPath $HostsPath -Raw
$pattern = '(?ms)^\# BEGIN Agency OS Docker Host Browser\r?\n.*?^\# END Agency OS Docker Host Browser\r?\n?'
$CleanHosts = [Text.RegularExpressions.Regex]::Replace($HostsContent, $pattern, '')
[IO.File]::WriteAllText($HostsPath, $CleanHosts, [Text.UTF8Encoding]::new($false))

if (-not [bool]$State.caWasAlreadyTrusted) {
  $CertificatePath = "Cert:\LocalMachine\Root\$($State.caThumbprint)"
  if (Test-Path -LiteralPath $CertificatePath) { Remove-Item -LiteralPath $CertificatePath -Force }
}
Remove-Item -LiteralPath $StatePath -Force
Write-Output 'Acceso local retirado; solo se eliminaron el bloque marcado y la CA añadida por Agency OS.'

