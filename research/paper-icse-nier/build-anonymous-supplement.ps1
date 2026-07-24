param(
    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [string]$CreatedAt = ""
)

$ErrorActionPreference = "Stop"

$researchRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$paperRoot = (Resolve-Path $PSScriptRoot).Path
$artifactPath = [System.IO.Path]::GetFullPath($ArtifactRoot)
$sourceManifestPath = Join-Path $artifactPath "source-public-manifest.json"
$supplementPath = Join-Path $artifactPath "supplement"
$supplementManifestPath = Join-Path $artifactPath "anonymous-supplement-manifest.json"
$manuscriptPath = Join-Path $artifactPath "manuscript"
$packageManifestPath = Join-Path $artifactPath "anonymous-package-manifest.json"
$verificationEnvironment = "$artifactPath-verification-venv"

if (Test-Path -LiteralPath $artifactPath) {
    throw "Anonymous artifact root must not already exist."
}

New-Item -ItemType Directory -Path $artifactPath | Out-Null

$buildArgs = @(
    "run", "--directory", $researchRoot, "memorixbench", "build-public-release",
    "--root", $researchRoot, "--output", $sourceManifestPath
)
if (-not [string]::IsNullOrWhiteSpace($CreatedAt)) {
    $buildArgs += @("--created-at", $CreatedAt)
}
& uv @buildArgs
if ($LASTEXITCODE -ne 0) {
    throw "Source public-release manifest build failed."
}

& uv run --directory $researchRoot memorixbench audit-public-artifact-manifest `
    --root $researchRoot --manifest $sourceManifestPath
if ($LASTEXITCODE -ne 0) {
    throw "Source public-release audit failed."
}

& uv run --directory $researchRoot memorixbench materialize-public-artifact `
    --root $researchRoot --manifest $sourceManifestPath --target $supplementPath
if ($LASTEXITCODE -ne 0) {
    throw "Source public-release materialization failed."
}

# The public artifact is anonymous except for this request header. Neutralizing
# it preserves behavior for offline artifact checks without linking reviewers
# to the non-anonymous project page.
$agentSource = Join-Path $supplementPath "src\memorixbench\agents.py"
$agentText = [System.IO.File]::ReadAllText($agentSource)
$identityUrl = "https://github.com/AVIDS2/memorix"
if (-not $agentText.Contains($identityUrl)) {
    throw "Expected project-identifying request header was not found."
}
$agentText = $agentText.Replace($identityUrl, "https://example.invalid/memorixbench")
[System.IO.File]::WriteAllText(
    $agentSource,
    $agentText,
    (New-Object System.Text.UTF8Encoding($false))
)

$previousUvProjectEnvironment = $env:UV_PROJECT_ENVIRONMENT
$previousNoBytecode = $env:PYTHONDONTWRITEBYTECODE
try {
    $env:UV_PROJECT_ENVIRONMENT = $verificationEnvironment
    $env:PYTHONDONTWRITEBYTECODE = "1"

    & uv run --directory $supplementPath memorixbench build-public-release `
        --root $supplementPath --output $supplementManifestPath
    if ($LASTEXITCODE -ne 0) {
        throw "Anonymous supplement manifest build failed."
    }

    & uv run --directory $supplementPath --extra dev pytest -q -p no:cacheprovider public-tests
    if ($LASTEXITCODE -ne 0) {
        throw "Anonymous supplement public tests failed."
    }

    & uv run --directory $supplementPath memorixbench audit-public-artifact-manifest `
        --root $supplementPath --manifest $supplementManifestPath --require-exact-tree
    if ($LASTEXITCODE -ne 0) {
        throw "Anonymous supplement exact-tree audit failed."
    }
} finally {
    $env:UV_PROJECT_ENVIRONMENT = $previousUvProjectEnvironment
    $env:PYTHONDONTWRITEBYTECODE = $previousNoBytecode
}

$identityMatches = Get-ChildItem -LiteralPath $supplementPath -Recurse -File |
    Select-String -Pattern "AVIDS2|memorix\.dev|github\.com/AVIDS2/memorix|npmjs\.com/package/memorix" -CaseSensitive:$false
if ($identityMatches) {
    throw "Anonymous supplement contains project-identifying text."
}

$forbiddenEntries = Get-ChildItem -LiteralPath $supplementPath -Force -Recurse |
    Where-Object {
        $_.Name -in @(".git", ".venv", "__pycache__") -or
        ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
    }
if ($forbiddenEntries) {
    throw "Anonymous supplement contains forbidden metadata or a reparse point."
}

New-Item -ItemType Directory -Path $manuscriptPath | Out-Null
Copy-Item -LiteralPath (Join-Path $paperRoot "main.pdf") -Destination (Join-Path $manuscriptPath "main.pdf")
Copy-Item -LiteralPath (Join-Path $paperRoot "main.tex") -Destination (Join-Path $manuscriptPath "main.tex")
Copy-Item -LiteralPath (Join-Path $paperRoot "references.bib") -Destination (Join-Path $manuscriptPath "references.bib")

$manifestEntries = Get-ChildItem -LiteralPath $artifactPath -Recurse -File |
    ForEach-Object {
        [pscustomobject]@{
            path = $_.FullName.Substring($artifactPath.Length + 1).Replace("\", "/")
            sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
            byte_count = $_.Length
        }
    } |
    Sort-Object path

$packageManifest = [ordered]@{
    schema_version = "anonymous-review-package-v1"
    review_status = "anonymous-local-candidate"
    supplement_identity_header = "neutralized-for-anonymous-review"
    entries = @($manifestEntries)
}
[System.IO.File]::WriteAllText(
    $packageManifestPath,
    ($packageManifest | ConvertTo-Json -Depth 4) + [Environment]::NewLine,
    (New-Object System.Text.UTF8Encoding($false))
)

$archivePath = "$artifactPath.zip"
Compress-Archive -Path (Join-Path $artifactPath "*") -DestinationPath $archivePath -CompressionLevel Optimal

Write-Output "ANONYMOUS_REVIEW_PACKAGE=$artifactPath"
Write-Output "ANONYMOUS_REVIEW_ARCHIVE=$archivePath"
