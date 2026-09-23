[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$InstallDir,
  [string]$NativeHostName = 'com.agencyos.helper'
)

# Baja de la estacion: retira solo lo que instalo Agency OS. No borra
# certificados, no revoca el dispositivo (eso se hace en Agency OS) y no toca
# otras politicas de Chrome.
$ErrorActionPreference = 'Stop'
$dataRoot = Join-Path $env:ProgramData 'AgencyOS'

# Detener el agente y sus Chrome de trabajo antes de retirar archivos.
Get-Process -Name 'agency-os-agent' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-CimInstance Win32_Process -Filter "Name = 'chromedriver.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*$dataRoot*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'AgencyOSAgent' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName" -Recurse -Force -ErrorAction SilentlyContinue

$forcelistPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
if (Test-Path -LiteralPath $forcelistPath) { Remove-ItemProperty -LiteralPath $forcelistPath -Name '1001' -ErrorAction SilentlyContinue }

# AutoSelectCertificateForUrls: retirar solo la entrada que escribio el
# instalador y solo si su valor sigue siendo el nuestro (si otra politica la
# reemplazo, se deja intacta). El nombre esta en chrome-policy.json.
$autoSelectPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\AutoSelectCertificateForUrls'
$policyState = Join-Path $dataRoot 'chrome-policy.json'
if ((Test-Path -LiteralPath $autoSelectPath -PathType Container) -and (Test-Path -LiteralPath $policyState -PathType Leaf)) {
  $state = Get-Content -LiteralPath $policyState -Raw | ConvertFrom-Json
  $current = (Get-ItemProperty -LiteralPath $autoSelectPath -Name $state.autoSelectName -ErrorAction SilentlyContinue).($state.autoSelectName)
  if ($current -eq $state.autoSelectValue) {
    Remove-ItemProperty -LiteralPath $autoSelectPath -Name $state.autoSelectName -ErrorAction SilentlyContinue
  }
}
Remove-Item -LiteralPath $policyState -Force -ErrorAction SilentlyContinue

Remove-Item -LiteralPath (Join-Path $InstallDir "$NativeHostName.json") -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $dataRoot 'agent.json') -Force -ErrorAction SilentlyContinue
Write-Output 'Componentes de Agency OS retirados. Los perfiles de Chrome y los certificados se conservaron.'
