param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [string]$CreatedAt = ""
)

$ErrorActionPreference = "Stop"
$researchRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$manifestPath = Join-Path $ArtifactRoot "public-artifact-manifest.json"
$releasePath = Join-Path $ArtifactRoot "public-release"

if (Test-Path -LiteralPath $manifestPath) {
    throw "The artifact root already has a manifest. Use a fresh artifact root."
}
if (Test-Path -LiteralPath $releasePath) {
    throw "The artifact root already has a release directory. Use a fresh artifact root."
}
New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null

$buildArgs = @(
    "run", "--directory", $researchRoot, "memorixbench", "build-public-release",
    "--root", $researchRoot, "--output", $manifestPath
)
if (-not [string]::IsNullOrWhiteSpace($CreatedAt)) {
    $buildArgs += @("--created-at", $CreatedAt)
}
& uv @buildArgs
if ($LASTEXITCODE -ne 0) {
    throw "Public release manifest build failed."
}

& uv run --directory $researchRoot memorixbench audit-public-artifact-manifest `
    --root $researchRoot --manifest $manifestPath
if ($LASTEXITCODE -ne 0) {
    throw "Source-tree artifact audit failed."
}

& uv run --directory $researchRoot memorixbench materialize-public-artifact `
    --root $researchRoot --manifest $manifestPath --target $releasePath
if ($LASTEXITCODE -ne 0) {
    throw "Public release materialization failed."
}

$previousUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
$previousNoBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
    $env:UV_PROJECT_ENVIRONMENT = Join-Path $ArtifactRoot "verification-venv"
    $env:PYTHONDONTWRITEBYTECODE = "1"
    & uv run --directory $releasePath --extra dev pytest -q -p no:cacheprovider public-tests
    if ($LASTEXITCODE -ne 0) {
        throw "Materialized public release self-test failed."
    }
} finally {
    $env:UV_PROJECT_ENVIRONMENT = $previousUvProjectEnvironment
    $env:PYTHONDONTWRITEBYTECODE = $previousNoBytecode
}

& uv run --directory $researchRoot memorixbench audit-public-artifact-manifest `
    --root $releasePath --manifest $manifestPath --require-exact-tree
if ($LASTEXITCODE -ne 0) {
    throw "Materialized public release audit failed."
}

Write-Output "PUBLIC_RELEASE=$releasePath"
