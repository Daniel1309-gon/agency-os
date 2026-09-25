[CmdletBinding()]
param(
  [switch]$SkipClean
)

# Construye agency-os-agent.exe con uv (sin venv en el repositorio).
# Versiones fijadas para que el binario sea reproducible; subirlas es una
# decision explicita, no un efecto de resolver "latest" el dia del build.
$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PyInstallerVersion = '6.22.3'
$SeleniumVersion = '4.49.0'

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  throw 'uv no esta instalado. Instalarlo desde https://docs.astral.sh/uv/ antes de compilar.'
}

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'chromedriver.exe'))) {
  Write-Output 'Aviso: no hay chromedriver.exe junto al spec; el agente usara Selenium Manager (requiere red).'
}

$arguments = @(
  'run',
  '--with', "pyinstaller==$PyInstallerVersion",
  '--with', "selenium==$SeleniumVersion",
  '--',
  'pyinstaller',
  '--noconfirm',
  '--distpath', (Join-Path $PSScriptRoot 'dist'),
  '--workpath', (Join-Path $PSScriptRoot 'build')
)
if (-not $SkipClean) { $arguments += '--clean' }
$arguments += (Join-Path $PSScriptRoot 'agent.spec')

Push-Location $ProjectRoot
try {
  & uv @arguments
  if ($LASTEXITCODE -ne 0) { throw "PyInstaller fallo con codigo $LASTEXITCODE" }
} finally {
  Pop-Location
}

$exe = Join-Path $PSScriptRoot 'dist\agency-os-agent\agency-os-agent.exe'
if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) { throw "No se genero $exe" }
$hash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output "Agente compilado: $exe"
Write-Output "SHA-256: $hash"
