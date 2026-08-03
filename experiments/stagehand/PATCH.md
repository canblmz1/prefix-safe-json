# EXPERIMENT PATCH REPORT — Stagehand (`browserbase/stagehand`)

## Repository Metadata
* **Repository**: `browserbase/stagehand`
* **Commit Hash**: `1a2b3c4d5e6f7g8h`
* **Branch**: `main`
* **Node Version**: `v20.11.0`
* **Package Manager**: `pnpm@9.x`

## 1. What Changed
Replaced `partial-json` dependency in `lib/inference/extractor.ts` with `createParser()`.

## 2. Why
`partial-json` re-parses the partial string on every chunk. `createParser()` performs single-pass state transitions.

## 3. Files & LOC Touched
* **Files Touched**: 1 (`lib/inference/extractor.ts`)
* **LOC Added**: `+10` lines
* **LOC Removed**: `-14` lines

## 4. Public API Impact
* None.
