[CmdletBinding()]
param(
  [string]$CertificateName = 'agency-pilot-pc01',
  [string]$Hostname = 'mtls-pilot.globalcompany.company'
)

# Retira el certificado del piloto y la política de Chrome añadida.
# Conserva el resto de políticas y certificados de la cuenta.
$ErrorActionPreference = 'Stop'
$ChromePolicyPath = 'HKCU:\Software\Policies\Google\Chrome\AutoSelectCertificateForUrls'

$removed = 0
Get-ChildItem -Path 'Cert:\CurrentUser\My' | Where-Object { $_.Subject -match "CN=$CertificateName" } | ForEach-Object {
  Remove-Item -LiteralPath $_.PSPath -Force
  $removed += 1
}

if (Test-Path -LiteralPath $ChromePolicyPath) {
  $properties = @((Get-Item -LiteralPath $ChromePolicyPath).Property | Where-Object { $_ -notmatch '^PS' })
  foreach ($name in $properties) {
    $value = (Get-ItemProperty -LiteralPath $ChromePolicyPath -Name $name).$name
    if ($value -like "*$Hostname*" -and $value -like "*$CertificateName*") {
      Remove-ItemProperty -LiteralPath $ChromePolicyPath -Name $name -Force
    }
  }
}

Write-Output "Certificados retirados: $removed. Política de Chrome del piloto eliminada."
