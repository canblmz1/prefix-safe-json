$ErrorActionPreference = "Continue"

Write-Host "--- TEST ---"
pnpm test

Write-Host "--- TEST:UNIT ---"
pnpm test:unit

Write-Host "--- TEST:CORPUS ---"
pnpm test:corpus

Write-Host "--- TEST:PROVIDERS ---"
pnpm test:providers

Write-Host "--- TEST:INVARIANTS ---"
pnpm test:invariants

Write-Host "--- TEST:FUZZ ---"
pnpm test:fuzz

Write-Host "--- VALIDATE-CORPUS ---"
pnpm validate-corpus

Write-Host "--- BENCH ---"
pnpm bench

Write-Host "--- BUILD ---"
pnpm build

Write-Host "--- PACK:CHECK ---"
pnpm pack:check

Write-Host "--- PACK DRY-RUN ---"
pnpm pack --dry-run
