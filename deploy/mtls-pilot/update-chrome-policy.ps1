[CmdletBinding()]
param(
  [string]$CertificateName = 'agency-pilot-pc01-v2',
  [string]$Hostname = 'mtls-pilot.globalcompany.company',
  [string]$LogPath = '.local\mtls-pilot\chrome-policy.log'
)

# Reescribe la entrada AutoSelectCertificateForUrls del piloto y deja la clave
# solo con el certificado indicado. Requiere elevación (clave de Administradores/SYSTEM).
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LogFull = Join-Path $ProjectRoot $LogPath
$ChromePolicyPath = 'HKCU:\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls'

"== inicio $(Get-Date -Format o) ==" | Out-File -FilePath $LogFull -Encoding utf8

try {
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
  "OK: AutoSelectCertificateForUrls[$nextIndex] = $entryJson" | Out-File -FilePath $LogFull -Append -Encoding utf8
} catch {
  "ERROR: $($_.Exception.Message)" | Out-File -FilePath $LogFull -Append -Encoding utf8
  throw
}
