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
