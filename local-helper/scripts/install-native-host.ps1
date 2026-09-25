param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory = $true)][ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })][string]$HelperPath,
  [string]$NativeHostName = 'com.agencyos.helper'
)

$ErrorActionPreference = 'Stop'

$resolvedHelper = (Resolve-Path -LiteralPath $HelperPath).Path
$manifestDirectory = Join-Path ${env:ProgramFiles} 'Agency OS'
$manifestPath = Join-Path $manifestDirectory ($NativeHostName + '.json')
New-Item -ItemType Directory -Path $manifestDirectory -Force | Out-Null

$manifest = [ordered]@{
  name = $NativeHostName
  description = 'Agency OS Native Messaging helper'
  path = $resolvedHelper
  type = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Native host manifest was not created: $manifestPath"
}

$registryPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$NativeHostName"
New-Item -Path $registryPath -Force | Out-Null
Set-ItemProperty -Path $registryPath -Name '(default)' -Value $manifestPath
if ((Get-ItemProperty -LiteralPath $registryPath).'(default)' -ne $manifestPath) {
  throw "Native host registry entry does not point to the manifest: $manifestPath"
}
Write-Output "Native host registered: $NativeHostName"
