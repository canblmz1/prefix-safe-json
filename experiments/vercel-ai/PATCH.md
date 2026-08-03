# EXPERIMENT PATCH REPORT — Vercel AI SDK (`vercel/ai`)

## Repository Metadata
* **Repository**: `vercel/ai`
* **Commit Hash**: `3a8f9c1b7e20102d`
* **Branch**: `main`
* **Node Version**: `v20.11.0`
* **Package Manager**: `pnpm@9.x`

## 1. What Changed
Replaced internal regex-based `parsePartialJson()` in `packages/ui-utils/src/parse-partial-json.ts` with `createParser()`.

## 2. Why
Regex repairs scale at $O(n^2)$ time complexity. `createParser()` performs single-pass state transitions.

## 3. Files & LOC Touched
* **Files Touched**: 1 (`packages/ui-utils/src/parse-partial-json.ts`)
* **LOC Added**: `+12` lines
* **LOC Removed**: `-52` lines

## 4. Public API Impact
* None. Signature of `parsePartialJson` remains identical.
