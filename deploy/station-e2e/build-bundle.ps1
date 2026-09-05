[CmdletBinding()]
param(
  [ValidatePattern('^$|^[a-p]{32}$')][string]$ExtensionId = '',
  [string]$BundleVersion = '0.1.0'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$LocalRoot = Join-Path $ProjectRoot '.local\station-e2e'
$StationEnvPath = Join-Path $LocalRoot 'station.env'
if (-not $ExtensionId -and (Test-Path -LiteralPath $StationEnvPath -PathType Leaf)) {
  $ConfiguredExtension = Get-Content -LiteralPath $StationEnvPath | Where-Object { $_ -match '^EXTENSION_ID=' } | Select-Object -First 1
  if ($ConfiguredExtension) { $ExtensionId = $ConfiguredExtension.Substring('EXTENSION_ID='.Length).Trim() }
}
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Indique -ExtensionId o inicialice .local/station-e2e/station.env.' }
$BundleRoot = Join-Path $LocalRoot 'bundles'
$Stage = Join-Path $BundleRoot "agency-os-station-$BundleVersion"
$ZipPath = "$Stage.zip"
$CaPath = Join-Path $LocalRoot 'pki\ca.crt'
$CrxPath = Join-Path $LocalRoot 'extension-public\agency-os.crx'
foreach ($required in @($CaPath, $CrxPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Falta el artefacto previo: $required" }
}

function Get-Sha256Hex([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $algorithm.ComputeHash($stream)
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
  } finally {
    $algorithm.Dispose()
    $stream.Dispose()
  }
}

New-Item -ItemType Directory -Path $BundleRoot -Force | Out-Null
if (Test-Path -LiteralPath $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
New-Item -ItemType Directory -Path $Stage -Force | Out-Null

$PreviousGoOs = $env:GOOS
$PreviousGoArch = $env:GOARCH
$PreviousCgo = $env:CGO_ENABLED
$PreviousGoCache = $env:GOCACHE
try {
  $env:GOOS = 'windows'
  $env:GOARCH = 'amd64'
  $env:CGO_ENABLED = '0'
  $env:GOCACHE = Join-Path $LocalRoot 'go-cache'
  New-Item -ItemType Directory -Path $env:GOCACHE -Force | Out-Null
  & go build -C (Join-Path $ProjectRoot 'local-helper') -trimpath -ldflags '-s -w' -o (Join-Path $Stage 'agency-os-helper.exe') ./cmd/agency-os-helper
  if ($LASTEXITCODE -ne 0) { throw 'No se pudo compilar el helper Windows x64.' }
} finally {
  $env:GOOS = $PreviousGoOs
  $env:GOARCH = $PreviousGoArch
  $env:CGO_ENABLED = $PreviousCgo
  $env:GOCACHE = $PreviousGoCache
}

foreach ($name in @('preflight.ps1', 'install.ps1', 'uninstall.ps1', 'RUNBOOK.md')) {
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "station\$name") -Destination (Join-Path $Stage $name)
}
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'extension\scripts\install-managed-policy.ps1') -Destination (Join-Path $Stage 'install-managed-policy.ps1')
Copy-Item -LiteralPath $CaPath -Destination (Join-Path $Stage 'agency-os-station-e2e-ca.crt')

$CommitSha = (& git -C $ProjectRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $CommitSha -notmatch '^[0-9a-f]{40}$') { throw 'No se pudo determinar el commit SHA.' }
$ApiDigest = (& docker image inspect agency-os-api:station-e2e --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or -not $ApiDigest) { throw 'No existe la imagen agency-os-api:station-e2e construida.' }
$GatewayDigest = (& docker image inspect agency-os-gateway:station-e2e --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or -not $GatewayDigest) { throw 'No existe la imagen agency-os-gateway:station-e2e construida.' }
$HelperHash = Get-Sha256Hex (Join-Path $Stage 'agency-os-helper.exe')
$CrxHash = Get-Sha256Hex $CrxPath
$Manifest = [ordered]@{
  bundleVersion = $BundleVersion
  createdAt = [DateTimeOffset]::UtcNow.ToString('o')
  commitSha = $CommitSha
  extensionId = $ExtensionId
  artifacts = [ordered]@{
    helperSha256 = $HelperHash
    crxSha256 = $CrxHash
    crxUrl = 'https://app.agency-os.test/extension/agency-os.crx'
    apiImageDigest = $ApiDigest
    gatewayImageDigest = $GatewayDigest
  }
}
[IO.File]::WriteAllText((Join-Path $Stage 'artifact-manifest.json'), (($Manifest | ConvertTo-Json -Depth 6) + "`n"), [Text.UTF8Encoding]::new($false))

$ForbiddenFiles = @(Get-ChildItem -LiteralPath $Stage -Recurse -File | Where-Object { $_.Name -match '\.(pem|key)$|device-token|secret|credential' })
if ($ForbiddenFiles.Count) { throw 'El stage del bundle contiene material privado o secreto.' }
$PrivateMarkers = @(Get-ChildItem -LiteralPath $Stage -Recurse -File | Select-String -SimpleMatch 'BEGIN PRIVATE KEY', 'BEGIN RSA PRIVATE KEY' -ErrorAction SilentlyContinue)
if ($PrivateMarkers.Count) { throw 'El stage del bundle contiene un marcador privado o un token.' }

$ChecksumLines = Get-ChildItem -LiteralPath $Stage -File | Sort-Object Name | ForEach-Object {
  $hash = Get-Sha256Hex $_.FullName
  "$hash  $($_.Name)"
}
[IO.File]::WriteAllText((Join-Path $Stage 'SHA256SUMS.txt'), (($ChecksumLines -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath $ZipPath -CompressionLevel Optimal
Write-Output "Bundle offline creado: $ZipPath"
