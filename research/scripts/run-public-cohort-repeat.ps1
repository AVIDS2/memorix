param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 3)]
    [int]$Repetition,

    [Parameter(Mandatory = $true)]
    [int]$Seed,

    [Parameter(Mandatory = $true)]
    [string]$ArtifactRoot,

    [string]$PlanPath = "public-cohort-plans/memorixbench-public-cohort-v1.json",

    [string]$MemorixCli = "",

    [string]$Mem0Python = "",

    [string]$AgentMemoryRuntime = ""
)

$ErrorActionPreference = "Stop"
$researchRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
if ([System.IO.Path]::IsPathRooted($PlanPath) -or $PlanPath -match "(^|[\\/])\.\.([\\/]|$)") {
    throw "PlanPath must stay relative to the public research root."
}
$planPath = Join-Path $researchRoot $PlanPath
$registryPath = Join-Path $researchRoot "cases\\REGISTRY.toml"
$casesRoot = Join-Path $researchRoot "cases"
$plan = Get-Content -LiteralPath $planPath -Raw | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]$plan.model)) {
    throw "The frozen plan must name one exact model."
}
if ($plan.agent -ne "openrouter") {
    throw "This runner only supports the frozen OpenRouter public cohort."
}
if ($plan.conditions -contains "memorix-1.2.1-canonical-local" -and [string]::IsNullOrWhiteSpace($MemorixCli)) {
    throw "This cohort plan requires -MemorixCli."
}
if ($plan.conditions -contains "mem0-2.0.12-local" -and [string]::IsNullOrWhiteSpace($Mem0Python)) {
    throw "This cohort plan requires -Mem0Python."
}
if ($plan.conditions -contains "agentmemory-0.9.28-full-local" -and [string]::IsNullOrWhiteSpace($AgentMemoryRuntime)) {
    throw "This cohort plan requires -AgentMemoryRuntime."
}

$summaryPath = Join-Path $ArtifactRoot "repeat-$Repetition-summary.json"
if (Test-Path -LiteralPath $summaryPath) {
    throw "This artifact root already has a summary for repetition $Repetition. Use a fresh root after any failed repetition."
}
New-Item -ItemType Directory -Path $ArtifactRoot -Force | Out-Null
$caseDirectories = Get-ChildItem -LiteralPath (Join-Path $casesRoot "public-evaluation") -Directory |
    Sort-Object Name
$rows = @()

Push-Location $researchRoot
try {
    & uv run --directory $researchRoot memorixbench validate-public-cohort-plan `
        $PlanPath `
        --registry "cases/REGISTRY.toml" `
        --cases-root "cases"
    if ($LASTEXITCODE -ne 0) {
        throw "The frozen public cohort plan failed validation."
    }

    foreach ($case in $caseDirectories) {
        foreach ($condition in $plan.conditions) {
            $casePath = "cases/public-evaluation/$($case.Name)/case.toml"
            $logPath = Join-Path $ArtifactRoot "$($case.Name)-$condition-r$Repetition.log"
            Write-Output "START case=$($case.Name) condition=$condition repetition=$Repetition"
            & uv run --directory $researchRoot memorixbench run-trial $casePath `
                --artifact-root $ArtifactRoot `
                --registry "cases/REGISTRY.toml" `
                --study-id $plan.plan_id `
                --condition $condition `
                --agent $plan.agent `
                --model $plan.model `
                --required-single-model $plan.model `
                --repetition $Repetition `
                --seed $Seed `
                --timeout-seconds $plan.timeout_seconds `
                --max-budget-usd $plan.max_budget_usd `
                --memorix-cli $MemorixCli `
                --mem0-python $Mem0Python `
                --agentmemory-runtime $AgentMemoryRuntime `
                --allow-agent-execution *> $logPath
            $exitCode = $LASTEXITCODE
            $latestRun = Get-ChildItem -LiteralPath (Join-Path $ArtifactRoot "runs") -Directory -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending |
                Select-Object -First 1
            $resultPath = if ($latestRun) { Join-Path $latestRun.FullName "result.json" } else { "" }
            if ($resultPath -and (Test-Path -LiteralPath $resultPath)) {
                $result = Get-Content -LiteralPath $resultPath -Raw | ConvertFrom-Json
                $row = [pscustomobject]@{
                    Case = $case.Name
                    Condition = $condition
                    Repetition = $Repetition
                    Seed = $Seed
                    ExitCode = $exitCode
                    RunId = $result.run_id
                    Valid = $result.valid_run
                    Success = $result.task_success
                    Failure = $result.failure_reason
                    ToolCalls = $result.tool_call_count
                    Seconds = [math]::Round([double]$result.wall_seconds, 2)
                    Cost = $result.cost_usd
                }
                $rows += $row
                Write-Output "DONE case=$($case.Name) condition=$condition valid=$($result.valid_run) success=$($result.task_success) failure=$($result.failure_reason)"
                if (-not $result.valid_run) {
                    throw "Invalid trial for $($case.Name) / $($condition): $($result.failure_reason)"
                }
            } else {
                $rows += [pscustomobject]@{
                    Case = $case.Name
                    Condition = $condition
                    Repetition = $Repetition
                    Seed = $Seed
                    ExitCode = $exitCode
                    RunId = $null
                    Valid = $false
                    Success = $false
                    Failure = "no-result"
                    ToolCalls = $null
                    Seconds = $null
                    Cost = $null
                }
                Write-Output "DONE case=$($case.Name) condition=$condition no-result exit=$exitCode"
                throw "No result was produced for $($case.Name) / $($condition)."
            }
        }
    }
} finally {
    Pop-Location
    $rows | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $summaryPath -Encoding utf8
}

$rows | Format-Table -AutoSize
Write-Output "ARTIFACT=$ArtifactRoot"
