# EXPERIMENT PATCH REPORT — Block Goose (`block/goose`)

## Repository Metadata
* **Repository**: `block/goose`
* **Commit Hash**: `9f8e7d6c5b4a3f2e`
* **Branch**: `main`
* **Node Version**: `v20.11.0`
* **Package Manager**: `cargo` / `pnpm`
* **Lockfile**: `pnpm-lock.yaml`

## 1. What Changed
Replaced try/catch `JSON.parse` exception polling in `ui/src/client/tool-stream.ts` with `createParser()`.

## 2. Why
`JSON.parse` throws exceptions on every partial delta chunk until the closing brace arrives. `createParser()` tracks root completion incrementally without throwing exceptions.

## 3. Files & LOC Touched
* **Files Touched**: 1 (`ui/src/client/tool-stream.ts`)
* **LOC Added**: `+14` lines
* **LOC Removed**: `-22` lines

## 4. Public API Impact
* None.

## 5. Rollback Strategy
Revert the commit touching `ui/src/client/tool-stream.ts`.
