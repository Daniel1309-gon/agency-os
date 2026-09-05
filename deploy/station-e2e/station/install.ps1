[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$ServerIp,
  [Parameter(Mandatory = $true)][string]$StationIpCidr,
  [Parameter(Mandatory = $true)][SecureString]$EnrollmentCode,
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId
)

$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'preflight.ps1') -ServerIp $ServerIp -StationIpCidr $StationIpCidr -ExtensionId $ExtensionId

$BeginMarker = '# BEGIN Agency OS Station E2E'
$EndMarker = '# END Agency OS Station E2E'
$HostsPath = Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'
$ProgramRoot = Join-Path $env:ProgramFiles 'Agency OS'
$DataRoot = 'C:\ProgramData\AgencyOS'
$HelperPath = Join-Path $ProgramRoot 'agency-os-helper.exe'
$NativeHostName = 'com.agencyos.helper'
$NativeManifestPath = Join-Path $ProgramRoot "$NativeHostName.json"
$TokenPath = Join-Path $DataRoot 'device-token.txt'
$StatePath = Join-Path $DataRoot 'install-state.json'
$CodePath = Join-Path $DataRoot 'enrollment-code.tmp'
$ForcelistValueName = '1001'
$ForcelistValue = "$ExtensionId;https://app.agency-os.test/extension/update.xml"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()

function Write-Utf8NoBom([string]$Path, [string]$Value) {
  [IO.File]::WriteAllText($Path, $Value, [Text.UTF8Encoding]::new($false))
}

function Remove-AgencyHostsBlock([string]$Content) {
  $pattern = '(?ms)^\# BEGIN Agency OS Station E2E\r?\n.*?^\# END Agency OS Station E2E\r?\n?'
  return [Text.RegularExpressions.Regex]::Replace($Content, $pattern, '')
}

$HostsContent = Get-Content -LiteralPath $HostsPath -Raw
$HostsContent = (Remove-AgencyHostsBlock $HostsContent).TrimEnd("`r", "`n")
$HostsBlock = "$BeginMarker`r`n$ServerIp app.agency-os.test`r`n$ServerIp api.agency-os.test`r`n$EndMarker`r`n"
Write-Utf8NoBom $HostsPath ($HostsContent + "`r`n" + $HostsBlock)

$ImportedCa = Import-Certificate -FilePath (Join-Path $PSScriptRoot 'agency-os-station-e2e-ca.crt') -CertStoreLocation 'Cert:\LocalMachine\Root'
if (-not $ImportedCa.Thumbprint) { throw 'No se pudo instalar la CA pública del ensayo.' }

New-Item -ItemType Directory -Path $ProgramRoot, $DataRoot -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'agency-os-helper.exe') -Destination $HelperPath -Force
& icacls.exe $DataRoot /inheritance:r /grant:r "$($identity.Name):(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir las ACL de C:\ProgramData\AgencyOS.' }

$NativeManifest = [ordered]@{
  name = $NativeHostName
  description = 'Agency OS Native Messaging helper'
  path = $HelperPath
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
} | ConvertTo-Json -Depth 4
Write-Utf8NoBom $NativeManifestPath ($NativeManifest + "`n")
$NativeRegistryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
New-Item -Path $NativeRegistryPath -Force | Out-Null
Set-ItemProperty -LiteralPath $NativeRegistryPath -Name '(default)' -Value $NativeManifestPath

$ForcelistPath = 'HKLM:\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist'
New-Item -Path $ForcelistPath -Force | Out-Null
$ExistingForcelistValue = (Get-ItemProperty -LiteralPath $ForcelistPath -Name $ForcelistValueName -ErrorAction SilentlyContinue).$ForcelistValueName
if ($ExistingForcelistValue -and $ExistingForcelistValue -ne $ForcelistValue) {
  throw "La entrada Enterprise $ForcelistValueName ya pertenece a otra extensión."
}
New-ItemProperty -LiteralPath $ForcelistPath -Name $ForcelistValueName -PropertyType String -Value $ForcelistValue -Force | Out-Null

$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($EnrollmentCode)
try {
  $PlainEnrollmentCode = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  Write-Utf8NoBom $CodePath $PlainEnrollmentCode
  & icacls.exe $CodePath /inheritance:r /grant:r "$($identity.Name):F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo restringir el archivo temporal de enrolamiento.' }
  $EnrollmentOutput = & $HelperPath enroll --api-base-url 'https://api.agency-os.test/api/v1' --code-file $CodePath --hostname $env:COMPUTERNAME --label "Estación E2E $env:COMPUTERNAME" --token-file $TokenPath 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'El helper rechazó el enrolamiento.' }
} finally {
  $PlainEnrollmentCode = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  Remove-Item -LiteralPath $CodePath -Force -ErrorAction SilentlyContinue
}
& icacls.exe $TokenPath /inheritance:r /grant:r "$($identity.Name):F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron restringir las ACL del token del dispositivo.' }
$EnrollmentText = ($EnrollmentOutput | Out-String)
if ($EnrollmentText -notmatch 'Device ([0-9a-fA-F-]{36}) enrolled') { throw 'El helper no devolvió un identificador de dispositivo válido.' }
$DeviceId = $Matches[1]

& (Join-Path $PSScriptRoot 'install-managed-policy.ps1') -ExtensionId $ExtensionId -ApiBaseUrl 'https://api.agency-os.test/api/v1' -WebAppOrigin 'https://app.agency-os.test' -DeviceTokenFile $TokenPath -NativeHostName $NativeHostName | Out-Null

$State = [ordered]@{
  schemaVersion = 1
  deviceId = $DeviceId
  extensionId = $ExtensionId
  forcelistValueName = $ForcelistValueName
  forcelistValue = $ForcelistValue
  nativeHostName = $NativeHostName
  caThumbprint = $ImportedCa.Thumbprint
  installedUserSid = $identity.User.Value
  serverIp = $ServerIp
  installedAt = [DateTimeOffset]::UtcNow.ToString('o')
}
Write-Utf8NoBom $StatePath (($State | ConvertTo-Json -Depth 4) + "`n")
& icacls.exe $StatePath /inheritance:r /grant:r "$($identity.Name):F" '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null

$null = Invoke-WebRequest -UseBasicParsing -Uri 'https://app.agency-os.test/healthz' -TimeoutSec 15
$null = Invoke-WebRequest -UseBasicParsing -Uri 'https://api.agency-os.test/health/ready' -TimeoutSec 15
Write-Output 'Estación instalada. Reinicie Chrome y valide chrome://policy bajo este mismo usuario dedicado.'
Write-Output 'El código y el token no se imprimieron; no pulse Log in durante el ensayo ficticio.'

