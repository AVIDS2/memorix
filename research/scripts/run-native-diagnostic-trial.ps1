param(
    [Parameter(Mandatory = $true)]
    [string]$CasePath,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [Parameter(Mandatory = $true)]
    [string]$WorkspaceRoot,

    [Parameter(Mandatory = $true)]
    [string]$MemorixCli,

    [Parameter(Mandatory = $true)]
    [string]$ClaudeProviderSettings,

    [Parameter(Mandatory = $true)]
    [string]$ExpectedModel,

    [Parameter(Mandatory = $true)]
    [ValidateSet(
        "no-memory",
        "memorix-1.2.1-native-autopilot-local",
        "memorix-1.2.1-selective-local",
        "memorix-1.2.1-delivery-no-freshness-local",
        "memorix-1.2.1-delivery-no-current-state-local",
        "memorix-1.2.1-delivery-no-semantic-code-local",
        "memorix-1.2.1-delivery-no-knowledge-local",
        "memorix-1.2.1-delivery-no-workflow-local"
    )]
    [string]$Condition,

    [ValidateRange(1, 2)]
    [int]$Repetition = 1,

    [int]$Seed = 1729,

    [ValidateRange(1, 300)]
    [int]$TimeoutSeconds = 300,

    [ValidateRange(0.001, 1.0)]
    [double]$MaxBudgetUsd = 0.10,

    [string]$StudyId = "native-product-diagnostic-v1"
)

$ErrorActionPreference = "Stop"
$researchRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$artifactPath = [System.IO.Path]::GetFullPath($ArtifactRoot)
$workspacePath = [System.IO.Path]::GetFullPath($WorkspaceRoot)
$caseFullPath = (Resolve-Path -LiteralPath $CasePath).Path
$memorixCliPath = (Resolve-Path -LiteralPath $MemorixCli).Path
$providerSettingsPath = (Resolve-Path -LiteralPath $ClaudeProviderSettings).Path
$caseRoot = ((Resolve-Path -LiteralPath (Join-Path $researchRoot "cases")).Path.TrimEnd([char[]]'\')) + '\'

if (Test-Path -LiteralPath $artifactPath) {
    throw "ArtifactRoot must be a fresh directory."
}
if ($artifactPath.TrimEnd([char[]]'\') -eq $workspacePath.TrimEnd([char[]]'\')) {
    throw "ArtifactRoot and WorkspaceRoot must be separate."
}
if (-not $caseFullPath.StartsWith($caseRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "CasePath must stay under the research cases directory."
}

$parent = Split-Path -Parent $artifactPath
$leaf = Split-Path -Leaf $artifactPath
$preflightRoot = Join-Path $parent "$leaf-route-preflight"
if (Test-Path -LiteralPath $preflightRoot) {
    throw "Route preflight artifact root already exists. Use a fresh ArtifactRoot."
}

Push-Location $researchRoot
try {
    & uv run --directory $researchRoot memorixbench preflight-model-route `
        --output $preflightRoot `
        --claude-provider-settings $providerSettingsPath `
        --model $ExpectedModel `
        --uniform-role-model $ExpectedModel `
        --expected-reported-model $ExpectedModel `
        --timeout-seconds 120 `
        --max-budget-usd $MaxBudgetUsd
    if ($LASTEXITCODE -ne 0) {
        throw "The isolated single-model route preflight did not pass. No task was started."
    }

    & uv run --directory $researchRoot memorixbench run-trial $caseFullPath `
        --artifact-root $artifactPath `
        --study-id $StudyId `
        --condition $Condition `
        --agent claude `
        --model $ExpectedModel `
        --required-single-model $ExpectedModel `
        --uniform-role-model $ExpectedModel `
        --repetition $Repetition `
        --seed $Seed `
        --timeout-seconds $TimeoutSeconds `
        --max-budget-usd $MaxBudgetUsd `
        --memorix-cli $memorixCliPath `
        --workspace-root $workspacePath `
        --claude-provider-settings $providerSettingsPath `
        --allow-agent-execution
    if ($LASTEXITCODE -ne 0) {
        throw "Native diagnostic trial did not complete. Inspect the local artifact receipt."
    }
} finally {
    Pop-Location
}

Write-Output "ARTIFACT=$artifactPath"
Write-Output "ROUTE_PREFLIGHT=$preflightRoot"
