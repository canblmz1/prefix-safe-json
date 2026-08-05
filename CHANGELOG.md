# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project is pre-1.0 (`0.0.1-alpha.0`); see [RELEASE.md](RELEASE.md) for
the quantitative bar (mutation score, coverage) a version bump requires.

## [Unreleased]

Result of an extended, multi-round adversarial audit: differential testing
against `JSON.parse`, fuzz testing, exhaustive chunk-boundary testing,
mutation testing (Stryker), memory/leak testing, resource-limit boundary
testing, and manual review. 13 real defects were found and fixed, each with
a regression test proven to fail before the fix and pass after.

### Fixed

- **utf8**: `push()`-ing a single chunk containing a large string
  (roughly >130KB) threw `RangeError: Maximum call stack size exceeded`,
  from spreading the entire decoded code-point array as `String.fromCodePoint`
  call arguments in one call.
- **semantic**: object keys equal to `"__proto__"` were silently dropped
  from `stableValue` instead of preserved as a real own property — bracket
  assignment (`obj[key] = value`) reassigns an object's prototype instead of
  creating a property for that specific key.
- **semantic**: `snapshot()`/`finish()` could crash (`RangeError`) on
  documents nested deeper than roughly 5000 levels, from a recursive
  `deepClone` implementation.
- **parser**: the diagnostics/repairs history arrays grew unbounded for the
  lifetime of a parser, even for a consumer who calls `drainEvents()` after
  every `push()` and so never accumulates a large *live* event queue.
- **lexer**: numbers with a leading zero (`"01"`) or a trailing `.`/exponent
  marker with no following digit (`"1."`, `"1e+"`) were silently accepted,
  violating RFC 8259.
- **lexer**: `limits.maxStringBytes` was defined in the public options type
  but never actually enforced.
- **parser**: `result.executable` could be `true` while `result.outcome`
  was simultaneously `"invalid"`, when the event queue hit `maxQueuedEvents`
  at the exact moment the root container completed — `EventBuilder`'s own
  queue-capacity cutoff bypassed the diagnostic-tracking path `isExecutable()`
  relied on.
- **parser**: a bare top-level malformed number (the *entire* document is
  just `"01"`, `"-01"`, `"1."`, etc. — no wrapping container) reported
  `outcome: "truncated"` instead of `"invalid"`. The identical malformation
  wrapped in a container (`{"a":01}`) already reported `"invalid"`
  correctly via a different code path.
- **parser**: `Diagnostic`/`RepairAction` objects returned by
  `snapshot()`/`finish()` were mutable references into the parser's own
  internal history — external mutation of a returned object silently
  corrupted what every later `snapshot()`/`finish()` call reported.
- **parser / limits**: a non-finite limit value (`NaN`) — type-legal but
  semantically meaningless — silently disabled the corresponding resource
  limit entirely (every limit check is a `>`/`>=` comparison, always false
  against `NaN`), for all four parser-level limits plus the scanner's own
  independently-resolved `maxStringBytes`. Added `sanitizeLimit()`,
  applied everywhere a limit is resolved from user input.

### Performance

- **grammar**: container path resolution and attachment to the stable-value
  tree was amortized from O(depth) per container open (O(N²) total for N
  nested containers, regardless of whether any value inside them was ever
  committed) to O(1) amortized, via a lazily-computed memoized path getter
  on each grammar frame and a `WeakMap<GrammarFrame, JsonValue>` index from
  frame to stable-value node. Opening 6000 nested unclosed containers:
  ~12.4s → ~0.1s.

### Added

- **coordinator**: `createToolCallStreamCoordinator()` and
  `DefaultToolCallStreamCoordinator` accept an optional `parserOptions`
  parameter, forwarded to every per-call `IncrementalJsonParser` they
  construct. Previously every parser silently used library defaults with
  no way to configure limits or repair policy. Purely additive — omitting
  the parameter preserves prior behavior exactly.

### Removed

- **semantic**: deleted `SnapshotBuilder.removePath()` — confirmed
  unreachable (zero callers anywhere in source, tests, or compiled `dist/`
  output) via exhaustive repository-wide search. Never part of the public
  API (not exported from `src/index.ts`).
- **docs**: removed the "adoption lab" and "maintainer pack" content
  (`adapters/`, `reports/*.md`, `architecture.md`, `comparison.md`,
  `maintainer-package/`, and the corresponding test file). It claimed
  source-verified integrations and specific benchmark improvements
  (~6.5x–10.6x) against 5 external repositories; none of it held up against
  the real source of those repositories — fabricated commit hashes,
  a claimed function that doesn't exist, and internally self-contradictory
  benchmark numbers. See the real, evidence-based comparison that replaced
  it in the README.

### Documentation

- **README**: added a "Why not a general partial JSON parser?" section,
  grounded in actually cloning `vercel/ai` and `langchain-ai/langchainjs`
  and running their real `fixJson`/`parsePartialJson` implementations
  side-by-side with this library, demonstrating the concrete difference
  between "show a best guess early" and "never report a value until it's
  unambiguously complete."
- **README**: corrected a stale claim listing provider-specific adapters
  under "Not Yet Implemented" — `src/providers/` already has real, tested
  adapters for OpenAI (legacy `function_call` and Responses API),
  Anthropic, Gemini, OpenRouter, and generic OpenAI-compatible endpoints.
