$commands = @(
  "pnpm typecheck",
  "pnpm lint",
  "pnpm test",
  "pnpm test:unit",
  "pnpm test:corpus",
  "pnpm test:invariants",
  "pnpm test:providers",
  "pnpm test:fuzz",
  "pnpm validate-corpus",
  "pnpm build",
  "pnpm pack:check"
)

foreach ($cmd in $commands) {
  Write-Host "command: $cmd"
  $startTime = Get-Date
  
  # Run the command
  Invoke-Expression $cmd | Out-Null
  $exitCode = $LASTEXITCODE

  $endTime = Get-Date
  $durationMs = ($endTime - $startTime).TotalMilliseconds
  $durationSec = [math]::Round($durationMs / 1000, 2)

  Write-Host "exit code: $exitCode"
  if ($exitCode -eq 0) {
    Write-Host "passed: true"
    Write-Host "failed: false"
  } else {
    Write-Host "passed: false"
    Write-Host "failed: true"
  }
  Write-Host "skipped: false"
  Write-Host "duration: ${durationSec}s"
  Write-Host ""
}
