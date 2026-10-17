[CmdletBinding()]
param(
  [string]$CertificateName = 'agency-pilot-pc01',
  [string]$Hostname = 'mtls-pilot.globalcompany.company'
)

# Escribe únicamente la entrada AutoSelectCertificateForUrls del piloto.
# Requiere elevación porque la clave de políticas de Chrome pertenece a
# Administradores/SYSTEM. Conserva las demás entradas.
$ErrorActionPreference = 'Stop'
$ChromePolicyPath = 'HKCU:\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls'
$entryJson = '{"pattern":"https://' + $Hostname + '","filter":{"SUBJECT":{"CN":"' + $CertificateName + '"}}}'

if (-not (Test-Path -LiteralPath $ChromePolicyPath)) { New-Item -Path $ChromePolicyPath -Force | Out-Null }
$existing = @((Get-Item -LiteralPath $ChromePolicyPath).Property | Where-Object { $_ -notmatch '^PS' })
$nextIndex = 1
while ($existing -contains "$nextIndex") { $nextIndex += 1 }
New-ItemProperty -LiteralPath $ChromePolicyPath -Name "$nextIndex" -PropertyType String -Value $entryJson -Force | Out-Null

Write-Output "Política Chrome escrita: AutoSelectCertificateForUrls[$nextIndex] = $entryJson"
