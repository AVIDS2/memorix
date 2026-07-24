param(
    [Parameter(Mandatory = $true)]
    [string]$MemorixCli,

    [Parameter(Mandatory = $true)]
    [string]$EventLog,

    [Parameter(Mandatory = $true)]
    [string]$DataDir,

    [Parameter(Mandatory = $true)]
    [string]$HomeDir,

    [ValidateSet("claude")]
    [string]$Agent = "claude"
)

$ErrorActionPreference = "Stop"
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

$stdinStream = [Console]::OpenStandardInput()
$buffer = [System.IO.MemoryStream]::new()
$stdinStream.CopyTo($buffer)
$rawBytes = $buffer.ToArray()
if ($rawBytes.Length -eq 0) {
    [Console]::Out.Write('{"continue":true}')
    exit 0
}

$eventPath = [System.IO.Path]::GetFullPath($EventLog)
$eventParent = [System.IO.Path]::GetDirectoryName($eventPath)
[System.IO.Directory]::CreateDirectory($eventParent) | Out-Null
$eventStream = [System.IO.File]::Open(
    $eventPath,
    [System.IO.FileMode]::Append,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::Read
)
try {
    $eventStream.Write($rawBytes, 0, $rawBytes.Length)
    $eventStream.WriteByte(10)
} finally {
    $eventStream.Dispose()
}

$rawText = $utf8.GetString($rawBytes)
$env:MEMORIX_DATA_DIR = [System.IO.Path]::GetFullPath($DataDir)
$env:MEMORIX_EMBEDDING = "off"
$env:HOME = [System.IO.Path]::GetFullPath($HomeDir)
$env:USERPROFILE = [System.IO.Path]::GetFullPath($HomeDir)

$rawText | & node $MemorixCli hook --agent $Agent
exit $LASTEXITCODE
