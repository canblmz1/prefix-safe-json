# Incremental JSON Parser Specification

This document defines the behavioral specification for the incremental JSON parser.

## Public API

### `createParser(options?)`
A factory function that creates and returns a new parser instance.
- **options**: Optional configuration for resource limits and strictness.

### `push(chunk: string | Uint8Array): PushResult`
Feeds a new chunk of data into the parser.
- **Returns**: A `PushResult` object containing:
  - `acceptedBytes`: Number of bytes successfully processed.
  - `emittedEvents`: Number of events generated during this push.
  - `syntax`: Current syntax status.
  - `terminal`: Boolean flag indicating if parsing has stopped due to a fatal error.

### `snapshot(): ParserSnapshot`
Returns the current, safe-to-read state of the parser.
- **Returns**: A `ParserSnapshot` containing:
  - `phase`: Current parsing phase.
  - `syntax`: Syntax validation status.
  - `stableValue`: Only fully committed values up to this point.
  - `rootComplete`: True if the root JSON structure is fully closed.
  - `executable`: True if the parsed JSON is perfectly valid and ready for execution.
  - `pendingTokens`: Unprocessed tokens waiting for context.
  - `repairs`: List of repairs applied.
  - `diagnostics`: List of generated diagnostics.
  - `byteCounters`: Processed and accepted byte counts.

### `drainEvents(): readonly ParserEvent[]`
Retrieves all unconsumed semantic events and clears the internal queue. This ensures bounded memory usage.

### `finish(meta?): FinalResult`
Signals the end of the input stream. This must be called before a parse is considered fully complete.
- **Returns**: A `FinalResult` indicating the overall outcome.

## StreamEndReason
When calling `finish()`, a reason must be provided (or inferred) from the following literal types:
- `"complete"`: Stream ended normally.
- `"length"`: Stream truncated due to length limits.
- `"network_error"`: Connection dropped or failed.
- `"provider_error"`: Upstream provider failure.
- `"cancelled"`: Explicit cancellation by the user.
- `"unknown"`: Unspecified end reason.

## Commit Contract
Values are only committed to the `stableValue` when unambiguously complete.

| Value Type | Commit Moment |
|---|---|
| String | Closing `"` seen |
| Number | Valid value terminator seen (whitespace, comma, close bracket, EOF) |
| true/false/null | Literal complete AND terminator seen |
| Object | Closing `}` seen |
| Array | Closing `]` seen |
| Object field | Unique key + committed value |
| Array element | Element value committed |

**Note on Numbers**: A number like `1` at a chunk boundary cannot be committed because the next chunk might contain `2}`, making the actual value `12`.

## Executable Contract
The `snapshot().executable` property is `true` ONLY when ALL of the following conditions are met:
- Root JSON fully closed.
- Stream completed normally (reason: `"complete"`).
- No pending tokens.
- No fatal diagnostics.
- No duplicate keys.
- No structural or lossy repairs.
- Stream not ended due to `"length"`, `"network_error"`, `"provider_error"`, or `"cancelled"`.

Note: `rootComplete` being `true` alone does NOT mean the document is `executable`.

## Semantic Event Model
The parser uses JSON Pointer-based monotonic events. It does not claim full RFC 6902 compliance.
Events available via `drainEvents()`:
- `value_committed`: `{ type, sequence, path, operation: "add", value, byteRange }`
- `container_closed`: `{ type, sequence, path, container: "object" | "array" }`
- `repair_applied`: `{ type, sequence, repair }`
- `diagnostic`: `{ type, sequence, diagnostic }`
- `document_complete`: `{ type, sequence, executable }`
- `stream_finished`: `{ type, sequence, outcome: "valid" | "truncated" | "salvaged" | "invalid" }`

`drainEvents()` returns only unconsumed events and clears the queue. Event history is NOT kept unbounded in memory.

## Duplicate Key Policy
- First occurrence wins.
- Does NOT change the previously committed value.
- Does NOT produce a replace event.
- Marks the document as invalid.
- Produces an `E_DUPLICATE_KEY` diagnostic.

## UTF-8 Decoder
- Handles `Uint8Array` chunks natively.
- Handles split multi-byte characters across chunk boundaries.
- Buffers incomplete bytes for the next `push()`.
- Does NOT silently replace invalid bytes with U+FFFD.
- Rejects overlong encodings.
- Detects invalid continuation bytes.
- Reports truncated UTF-8 at `finish()`.
- String input produces the exact same semantic result as the equivalent byte input.

## Lexical States
The scanner operates as a state machine using the following states:
`structural`, `object_key`, `string`, `escape`, `unicode_escape`, `unicode_surrogate_pending`, `number_integer`, `number_fraction`, `number_exponent_start`, `number_exponent`, `literal_true`, `literal_false`, `literal_null`, `trailing_whitespace`, `trailing_data`, `invalid`, `finished`.

## Grammar Stack
Container frames track:
- Container type (object, array)
- JSON Pointer path
- Object/array expectation states
- Next array index
- Seen keys (for duplicate detection)
- Open child containers

RFC 6901 escaping rules apply to paths: `~` → `~0`, `/` → `~1`.

## Diagnostic Codes
Diagnostics map expected anomalies in inputs (like malformed LLM output).
- `E_UNEXPECTED_TOKEN`
- `E_DUPLICATE_KEY`
- `E_INCOMPLETE_UTF8`
- `E_INVALID_UTF8`
- `E_INCOMPLETE_UNICODE_ESCAPE`
- `E_INVALID_UNICODE_ESCAPE`
- `E_UNPAIRED_SURROGATE`
- `E_UNTERMINATED_STRING`
- `E_INCOMPLETE_NUMBER`
- `E_INCOMPLETE_LITERAL`
- `E_TRAILING_DATA`
- `E_STREAM_TRUNCATED`
- `E_LIMIT_DEPTH`
- `E_LIMIT_INPUT_BYTES`
- `E_LIMIT_STRING_BYTES`
- `E_PUSH_AFTER_FINISH`
- `W_RAW_CONTROL_CHARACTER`
- `W_TRAILING_TEXT_ISOLATED`

Expected malformed LLM output produces a diagnostic, never an exception.
Programming errors (e.g., push after finish, invalid options) produce a runtime exception.

## Repair Policy (This Milestone)
No advanced repair is implemented in this milestone.
- `RepairAction` type is defined with: `code`, `byteRange`, `impact` (`representation_preserving` | `root_preserving` | `structural` | `lossy`), `description`.
- **Never**: guess partial strings, fabricate Unicode escapes, add missing digits, predict commas/colons, generate field values, call LLM, invent user data.

## Resource Limits
To prevent DoS vectors:
- `maxInputBytes`: 8MB
- `maxDepth`: 128
- `maxStringBytes`: 4MB
- `maxQueuedEvents`: 10000

Exceeding limits results in a terminal diagnostic. No crash, no infinite loop, no unbounded memory allocation.

## Invariants
- **Chunk invariance**: Same bytes split any way → same final result.
- **Valid JSON equivalence**: Valid complete JSON → matches `JSON.parse`, no repairs, no fatal diagnostics, executable after normal finish.
- **Prefix safety**: `stableValue` never contains partial values.
- **Event monotonicity**: Committed events are never retracted.
- **Finish honesty**: `finish({reason:"complete"})` vs `finish({reason:"length"})` must differ in `executable` status.
