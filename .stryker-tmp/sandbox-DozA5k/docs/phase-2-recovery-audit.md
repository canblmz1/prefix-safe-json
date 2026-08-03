# Phase 2 Recovery Audit

## Baseline Build & Typecheck Failures
- `scripts/generate-fuzz-fixtures.ts`: Unused `baseString` variable.
- `src/coordinator/coordinator.ts`: 
  - Unused `ToolCallRef`.
  - Type mismatch: `salvaged` not assignable to internal status type.
  - Type mismatch: `complete` state confused with `valid` outcome.
- `src/coordinator/types.ts`: Unused imports (`IncrementalJsonParser`, `Diagnostic`, `RepairAction`, `createParser`, `ToolCallRef`).
- `src/grammar/stack.ts`: Impossible array expectation comparison (`ArrayExpectation | undefined` compared to `"value"`).
- `src/lexer/scanner.ts`: Unused `esc` variable.
- `src/parser.ts`: Reversed `emitContainerClosed` arguments (`string` passed to `"object" | "array"`).
- `src/utf8/decoder.ts`: `DecodeResult` is missing `strippedBom`.

## Lint Failures
- 15 errors (mostly explicit `any` usages in provider adapters).
- 70 warnings (Forbidden non-null assertions across test files).

## Parser Correctness Failures (To Be Fixed)
- Incorrectly accepts adjacent array values without commas: `[1 2]`, `[true false]`, `["a" "b"]`, `[{} {}]`.
- Incorrectly accepts trailing commas: `[1,]`, `{"a":1,}`.
- Unsafe structural salvage on trailing comma cutoffs: `[1,` salvaged to `[1]`, `{"a":1,` to `{"a":1}`.
- Unknown finish safety: `reason: "unknown"` incorrectly produces `executable: true`.
- Anthropic max-token failure: doesn't prevent executable on `max_tokens`.
- OpenAI-compatible completion failure: `E_STREAM_ENDED_WITH_OPEN_CALL` on normal completion without `tool_call_end`.
- Missing OpenAI Responses API support.
- Gemini call duplication.

This audit serves as the baseline before commencing Step 2 and beyond.
