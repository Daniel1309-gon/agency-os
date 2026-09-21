[CmdletBinding()]
param(
  [string]$ApiBaseUrl = 'https://mtls-pilot.globalcompany.company/api/v1',
  [string]$WebOrigin = 'https://mtls-pilot.globalcompany.company',
  [string]$AgentRoot = '.local/mtls-pilot/agent',
  [string]$CertDir = '.local/mtls-pilot/mtls',
  [string]$CertificateName = 'agency-pilot-pc01',
  [int]$Port = 45832
)

# Arranque reproducible del agente del piloto con certificado de cliente.
# El token de dispositivo, la clave y el certificado nunca se imprimen.
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$TokenFile = Join-Path $ProjectRoot (Join-Path $AgentRoot 'device-token.txt')
$SlotRoot = Join-Path $ProjectRoot '.local/mtls-pilot/slots'
$CertFile = Join-Path $ProjectRoot (Join-Path $CertDir "$CertificateName.crt")
$KeyFile = Join-Path $ProjectRoot (Join-Path $CertDir "$CertificateName.key")

foreach ($required in @($TokenFile, $CertFile, $KeyFile)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Falta un archivo requerido del piloto: $required" }
}

Write-Output "Agente del piloto en 127.0.0.1:$Port (API $ApiBaseUrl)."
& uv run (Join-Path $ProjectRoot 'tools/agency-os-local-agent.py') `
  --api-base-url $ApiBaseUrl `
  --web-origin $WebOrigin `
  --device-token-file $TokenFile `
  --client-cert-file $CertFile `
  --client-key-file $KeyFile `
  --slot-root $SlotRoot `
  --port $Port
