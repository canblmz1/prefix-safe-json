# Decision Log

This log records key architectural and design decisions made for the incremental JSON parser.

## 1. Zero runtime dependencies
- **Rationale**: Security, bundle size, and elimination of supply chain risks. The parser must be trivial to audit and embed anywhere.

## 2. Incremental architecture
- **Rationale**: Amortized O(n) complexity. Avoids re-parsing the entire document on every new chunk, making it suitable for high-throughput streaming environments.

## 3. Duplicate key rejection
- **Rationale**: Determinism and first-wins semantics. By discarding duplicate keys, we prevent arbitrary data overwriting and maintain strict event monotonicity.

## 4. Diagnostic vs exception split
- **Rationale**: Malformed LLM output is an expected operational reality. Diagnostics track these without interrupting the pipeline. Exceptions are strictly reserved for consumer programming bugs.

## 5. Number commit delay
- **Rationale**: Chunk boundary ambiguity. A number like `1` at the end of a chunk cannot be committed because the next chunk might be `2}`, making the actual value `12`. It must wait for a terminator.

## 6. No U+FFFD silent replacement
- **Rationale**: LLM output should not be silently corrupted. Invalid UTF-8 is a data integrity issue and must be reported via diagnostics, not hidden.

## 7. Monotonic events
- **Rationale**: Allows consumers to build incremental UIs without implementing complex undo/rollback logic. Once committed, a value is final.

## 8. Drain-and-clear event queue
- **Rationale**: Bounded memory usage. Keeping an infinite history of semantic events would lead to Out-Of-Memory (OOM) crashes on large streams.

## 9. Execution gate built by composition over the coordinator, not a new state machine
- **Rationale**: `createToolCallExecutionGate()` holds a `ToolCallStreamCoordinator` instance and adds exactly one thing coordinator state doesn't already capture (which stream-end reason actually applied). It re-parses nothing and duplicates no event pipeline - `docs/EXECUTION_GATE.md`'s decision table is a pure function over `ToolCallState` + diagnostics + the stream-end reason.

## 10. `ExecuteDecision`/`NonExecutableDecision` as a discriminated union, not one type with an optional `value`
- **Rationale**: An optional field only "protects" `execute` callers by convention; a discriminated union makes `decision.value` a compile error unless `decision.action === "execute"` has already been checked. `NonExecutableDecision` has no `value` property at all (not `undefined` - absent), so there is no way to accidentally treat an unexecuted call's `undefined` as a legitimate value.

## 11. Fail-closed disqualifiers evaluated before the positive `execute` branch, and `execute` reached via an exhaustive switch with no `default`
- **Rationale**: Resource limits, provider errors, content-filter terminations, schema mismatches, and positively-observed truncation are all checked before the single `execute` branch is even considered - `execute` is deliberately the last positive case, not the first check, so a future coordinator status value that happens to superficially resemble "complete" still can't skip the checks ahead of it. The status-specific switch in `decideExecution()` has no `default` case; TypeScript's `noImplicitReturns` fails the build if `ToolCallState["status"]` ever gains a literal this function doesn't handle, instead of silently falling through to some default action at runtime.

## 12. Content-policy termination surfaced via a diagnostic code, not a new `StreamEndReason` literal
- **Rationale**: Recognizing "stopped by a content/safety filter" as distinct from a generic cancellation could have meant adding a 7th `StreamEndReason` literal - but that type is threaded through the core parser's `isExecutable()` reason check, so a new literal risks a silent gap if that check (an explicit whitelist of "bad" reasons) isn't updated in lockstep. Instead, a provider adapter that detects this case emits both `reason: "cancelled"` (using the existing, already-correctly-handled bucket) and a stream-wide `provider_diagnostic` with code `E_CONTENT_FILTERED` (`src/coordinator/diagnostic-codes.ts`). The gate matches on that diagnostic to report `content_filtered` specifically. Zero changes to the core parser or its executable contract.

## 13. AI SDK integration as a real core provider adapter, not example-only code
- **Rationale**: `src/providers/ai-sdk.ts` follows the same pattern as the other five adapters - hand-rolled local interfaces for the wire shape, zero import of the vendor package (`ai`) - so it adds no dependency, is exported and tested like any other adapter, and only ever reads raw `tool-input-delta` text into this library's own parser. It deliberately never reads the AI SDK's own resolved `tool-call.input`, which may already be silently repaired from a truncated stream by the SDK's internal `fixJson` - trusting it would reintroduce exactly the problem this library exists to prevent.
