param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ForwardArgs
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $scriptDir
$nodeScript = Join-Path $scriptDir "sync-openclaw-dev.mjs"

& node $nodeScript --repo-root $repoRoot @ForwardArgs
exit $LASTEXITCODE
