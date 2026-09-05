[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][SecureString]$AdministratorAccessToken
)

$ErrorActionPreference = 'Stop'
$BeginMarker = '# BEGIN Agency OS Station E2E'
$EndMarker = '# END Agency OS Station E2E'
$DataRoot = 'C:\ProgramData\AgencyOS'
$StatePath = Join-Path $DataRoot 'install-state.json'
if (-not (Test-Path -LiteralPath $StatePath -PathType Leaf)) { throw 'No existe el estado de instalación de Agency OS.' }
$State = Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Ejecute la desinstalación como Administrador.' }
if ($State.installedUserSid -ne $identity.User.Value) { throw 'La desinstalación debe ejecutarse bajo el mismo usuario dedicado que instaló Native Messaging.' }

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($AdministratorAccessToken)
try {
  $AccessToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  $Headers = @{ Authorization = "Bearer $AccessToken" }
  $Body = @{ reason = 'STATION_E2E_UNINSTALL' } | ConvertTo-Json -Compress
  $null = Invoke-RestMethod -Method Post -Uri "https://api.agency-os.test/api/v1/devices/$($State.deviceId)/revoke" -Headers $Headers -ContentType 'application/json' -Body $Body -TimeoutSec 15
} finally {
  $AccessToken = $null
  $Headers = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$ForcelistPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
$CurrentForcelist = (Get-ItemProperty -LiteralPath $ForcelistPath -Name $State.forcelistValueName -ErrorAction SilentlyContinue).($State.forcelistValueName)
if ($CurrentForcelist -eq $State.forcelistValue) {
  Remove-ItemProperty -LiteralPath $ForcelistPath -Name $State.forcelistValueName
}
$ManagedPolicyPath = "HKLM:\Software\Policies\Google\Chrome\3rdparty\Extensions\$($State.extensionId)\policy"
if (Test-Path -LiteralPath $ManagedPolicyPath) { Remove-Item -LiteralPath $ManagedPolicyPath -Recurse -Force }
$NativeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$($State.nativeHostName)"
if (Test-Path -LiteralPath $NativeRegistryPath) { Remove-Item -LiteralPath $NativeRegistryPath -Recurse -Force }

$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$HostsContent = Get-Content -LiteralPath $HostsPath -Raw
$pattern = '(?ms)^\# BEGIN Agency OS Station E2E\r?\n.*?^\# END Agency OS Station E2E\r?\n?'
$CleanHosts = [Text.RegularExpressions.Regex]::Replace($HostsContent, $pattern, '')
[IO.File]::WriteAllText($HostsPath, $CleanHosts, [Text.UTF8Encoding]::new($false))

$CertificatePath = "Cert:\LocalMachine\Root\$($State.caThumbprint)"
if (Test-Path -LiteralPath $CertificatePath) { Remove-Item -LiteralPath $CertificatePath -Force }
$ProgramRoot = Join-Path $env:ProgramFiles 'Agency OS'
foreach ($file in @('agency-os-helper.exe', "$($State.nativeHostName).json")) {
  $target = Join-Path $ProgramRoot $file
  if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
}
if ((Test-Path -LiteralPath $ProgramRoot) -and -not (Get-ChildItem -LiteralPath $ProgramRoot -Force)) { Remove-Item -LiteralPath $ProgramRoot -Force }
foreach ($file in @('device-token.txt', 'install-state.json')) {
  $target = Join-Path $DataRoot $file
  if (Test-Path -LiteralPath $target -PathType Leaf) { Remove-Item -LiteralPath $target -Force }
}
if ((Test-Path -LiteralPath $DataRoot) -and -not (Get-ChildItem -LiteralPath $DataRoot -Force)) { Remove-Item -LiteralPath $DataRoot -Force }

Write-Output 'Dispositivo revocado y componentes administrados retirados. Los perfiles de Chrome se conservaron para recolectar evidencia.'

