# EXPERIMENT PATCH REPORT — LangChain.js (`langchain-ai/langchainjs`)

## Repository Metadata
* **Repository**: `langchain-ai/langchainjs`
* **Commit Hash**: `8f4b2e9c1d01402a`
* **Branch**: `main`
* **Node Version**: `v20.11.0`
* **Package Manager**: `yarn@3.x` / `pnpm`

## 1. What Changed
Added `IncrementalToolCallOutputParser` class to `@langchain/core/output_parsers`.

## 2. Why
LangChain.js core does not support real-time partial argument streaming out of the box. Adding an incremental output parser allows live tool parameter streaming.

## 3. Files & LOC Touched
* **Files Touched**: 1 (`packages/core/src/output_parsers/incremental_tools.ts`)
* **LOC Added**: `+64` lines
* **LOC Removed**: `0` lines

## 4. Public API Impact
* None. Purely additive module.
