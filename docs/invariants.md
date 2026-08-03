# Invariants

This document formally defines the invariants that the incremental JSON parser must maintain at all times. These are strictly enforced through test suites.

## Chunk Invariance
**Definition**: The exact sequence of bytes passed into the parser will produce the exact same final parser state, `stableValue`, and event sequence, regardless of how those bytes are chunked or split across multiple `push()` calls.
- `push("ab")` must equal `push("a"); push("b")`.

## Valid JSON Equivalence
**Definition**: If the input is completely valid JSON according to RFC 8259, the parser's final `stableValue` must strictly deeply equal the result of `JSON.parse(input)`. 
- There must be no repairs applied.
- There must be no fatal diagnostics.
- The `executable` flag must be `true` after a normal `finish()`.

## Prefix Safety
**Definition**: The `stableValue` exposed via `snapshot()` must never contain partial or speculative data. 
- A string being read must not appear in `stableValue` until the closing `"` is processed.
- A number being read must not appear until its terminator is found.

## Event Monotonicity
**Definition**: Once a semantic event (like `value_committed`) is queued and drained, the parser will never emit a subsequent event that invalidates or retracts that state.
- Duplicate keys are ignored, meaning no `replace` event will overwrite a previously committed value.

## Finish Honesty
**Definition**: The `executable` status of a snapshot is fundamentally dependent on how the stream was finished. 
- Calling `finish({ reason: "complete" })` on valid closed JSON yields `executable: true`.
- Calling `finish({ reason: "length" })` on the exact same valid closed JSON yields `executable: false`, because a truncated stream cannot be trusted as semantically whole in the context of an LLM generation limit.

## No Crash
**Definition**: The parser must never throw a runtime exception during `push()` or `finish()` for any sequence of valid or invalid data bytes. 
- Exceptions are exclusively for consumer programming errors (e.g., invalid configurations, `push` after `finish`).
- Out-of-bounds inputs or resource limit violations result in terminal diagnostics, never crashes, infinite loops, or unbounded allocations.
