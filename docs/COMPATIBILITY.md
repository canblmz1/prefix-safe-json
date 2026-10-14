# Compatibility

What follows is scoped strictly to versions and surfaces actually
evidenced by this repository's source, tests, or commit history — not to
what is expected to work by extrapolation. Where no specific SDK package
version has been tested, that is stated explicitly rather than implied.

## Node runtime matrix

Runtime compatibility is tested independently from the repository's
development toolchain. The published package does not import any AI SDK at
runtime; AJV is its only direct runtime dependency.

| Surface | Node 18 | Node 20 | Node 22 | Node 24 | Evidence / minimum |
|---|---|---|---|---|---|
| `prefix-safe-json` package runtime | Yes | Yes | Yes | Yes | Packed-tarball CI installs the current candidate into isolated consumers and exercises its runtime on these Node lines. Declared minimum: `>=18.0.0`. |
| Exact `ai@5.0.244` dependency graph | Yes | Yes | Yes | Yes | `ai@5.0.244` and its AI SDK runtime dependencies declare Node `>=18`. |
| Exact `ai@6.0.264` dependency graph | `>=18.17` only | Yes | Yes | Yes | `ai@6.0.264` declares `>=18`; its exact `@ai-sdk/provider-utils@4.0.46` dependency declares `>=18.17`. |
| Exact `ai@7.0.77` dependency graph | No | No | Yes | Yes | `ai@7.0.77` and its AI SDK runtime dependencies declare Node `>=22`. |
| Repository development/release toolchain | No | Not a required CI target | Yes | Yes | Current dev dependencies include Node 20+ tools and the Node 22+ AI SDK v7 proof. Full CI/release validation remains on supported Node 22/24 lines. |

Node 18 and Node 20 are end-of-life and no longer receive security fixes.
Listing them as runtime-compatible is a statement about what the distributed
package can execute, not a recommendation to operate an unpatched runtime.
Consumers should prefer a supported Node line whenever possible.

The exact AI SDK lifecycle suites remain scoped to the three pins above and
run on the repository's supported development Node line. The AI SDK rows in
this table report the exact pins' declared runtime-engine compatibility; they
do not claim that every lifecycle suite was rerun on every Node matrix entry.

## Integration matrix

| Integration | Tested version(s) | Target API surface | Status | Raw evidence | Terminal evidence | Caveat |
|---|---|---|---|---|---|---|
| **Vercel AI SDK** (`ai` package) | `ai@5.0.244`, `ai@6.0.264`, `ai@7.0.77`. Lifecycle contract verified against these exact pinned versions; this is not a claim that every version in each major is tested. | `streamText()`'s `fullStream` (`TextStreamPart<TOOLS>` union) — `tool-input-start`/`-delta`/`-end`, `tool-call`, `tool-result`, `tool-error`, `finish`, `error`, `abort` parts | Stable (`createAiSdkExecutionGuard`), Experimental (`AiSdkStreamAdapter` directly) | Raw `tool-input-delta` text only — the SDK's own resolved `tool-call.input` is read by nothing in this adapter | `finishReason` literal union (`stop`/`length`/`content-filter`/`tool-calls`/`error`/`other`, identical wire vocabulary across all three tested majors) + `abort` part | Does **not** target the lower-level `@ai-sdk/provider` `LanguageModelV3`/`V4` `doStream()` boundary, where `finishReason` is `{ unified, raw }`-object-shaped, not a plain string. Building a provider directly against that interface needs different handling of that field — untested, unsupported by this adapter. |
| **OpenAI** (Chat Completions, legacy `function_call`) | `openai@7.8.0`, selected regressions through its real HTTP/SSE parser against a local fixture server | `choices[].delta.function_call` streaming deltas, `finish_reason` | Experimental | Raw `arguments` delta string | `finish_reason: "stop"\|"tool_calls"\|"function_call"\|"length"\|"cancelled"` | Legacy `function_call` shape, not the newer `tool_calls` array shape (see OpenAI-compatible below for that). Local-fixture evidence, not live-provider certification. |
| **OpenAI** (Responses API) | `openai@7.8.0`, selected lifecycle regressions through its real HTTP/SSE parser against a local fixture server | `response.completed`/`response.incomplete`/`response.failed`/`error` events | Experimental | Raw text deltas | `incomplete_details.reason` (`max_output_tokens`\|`content_filter`) | An unrecognized/missing `incomplete_details.reason` normalizes to `unknown`, never assumed complete. Local-fixture evidence, not live-provider certification. |
| **OpenAI-compatible** (generic; also underlies **OpenRouter**) | No specific SDK/version — targets the widely-used `choices[].delta.tool_calls[]` array shape shared by OpenAI's current API and most compatible endpoints | Explicit non-negative integer `choices[].index` + `tool_calls[].index` + `tool_calls[].function.{name,arguments}`, `finish_reason` | Experimental | Raw `arguments` delta string per choice/tool coordinate | `finish_reason` string | Missing, invalid, or duplicate explicit choice identity fails closed; outer array order is never guessed as identity. "Compatible" describes wire shape, not a hosted-vendor guarantee. |
| **OpenRouter** | No specific SDK/version — thin wrapper over `OpenAICompatibleStreamAdapter`'s shape, plus an `error` field | Same as OpenAI-compatible, plus OpenRouter's own `error` field on a choice | Experimental | Raw `arguments` delta string | `finish_reason` string, or `error` presence | Shares essentially all wire-shape risk with the OpenAI-compatible adapter above. |
| **Anthropic** (Messages API) | `@anthropic-ai/sdk@0.123.0`, selected lifecycle regressions through its real HTTP/SSE parser against a local fixture server | `input_json_delta.partial_json` deltas on `tool_use` content blocks, `stop_reason` | Experimental | Raw `partial_json` delta string | `message_stop` after `stop_reason: "end_turn"\|"tool_use"\|"max_tokens"` | Local-fixture evidence, not live-provider certification. |
| **Gemini** | `@google/genai@2.21.0`, selected identity/terminal regressions through its real HTTP/SSE parser against a local fixture server | `candidates[].content.parts[].functionCall` (**structured**, not streamed raw JSON text) | Experimental | Projection-only: the already-parsed `args` value is serialized for inspection/validation, never treated as raw proof | `finishReason: "STOP"\|"MAX_TOKENS"\|"SAFETY"\|"RECITATION"\|"OTHER"` | Even valid JSON, a valid schema, and `STOP` cannot produce strict `execute`; the gate rejects with `projection_only`. |

All five non-AI-SDK adapters have wire-shape coverage in
`test/providers/adapters.test.ts`, `test/providers/coverage.test.ts`,
`test/providers/provider-safety.test.ts`, and the provider-envelope corpus.
In addition, these integration suites exercise installed official SDK parsers
against a local loopback HTTP/SSE fixture server:

- [`openai-official-sdk-lifecycle.test.ts`](../test/integration/openai-official-sdk-lifecycle.test.ts) — `openai@7.8.0`;
- [`anthropic-official-sdk-lifecycle.test.ts`](../test/integration/anthropic-official-sdk-lifecycle.test.ts) — `@anthropic-ai/sdk@0.123.0`;
- [`gemini-official-sdk-lifecycle.test.ts`](../test/integration/gemini-official-sdk-lifecycle.test.ts) — `@google/genai@2.21.0`.

These are selected fixture/parser-reachability checks, not live provider calls,
a full protocol certification, or a claim covering all SDK versions. SDKs are
dev dependencies used by tests; the runtime adapters still do not import them.

The AI SDK claim is independently runnable with
`pnpm run example:ai-sdk-lifecycle-proof`. The proof drives each exact pinned
major's real `streamText()` lifecycle and reports observable counters for an
unsafe unlocked control, a locked unsafe termination, and a locked complete
call. It demonstrates one successful authority consumption and zero authority
on a second attempt. This is not sandboxing, authorization, durable idempotency,
or provider-side tool execution. `ai@5.0.244` has no approval
mechanism; its lock guarantee comes from removing callbacks. `ai@6.0.264` and
`ai@7.0.77` additionally use their approval mechanism as an `execute` backstop.

For an installed-package consumer check, copy
[`examples/npm-consumer/`](../examples/npm-consumer/) outside the checkout and
run `npm install --engine-strict --no-audit --no-fund`, then `npm start` on
Node 22+. It pins `prefix-safe-json@0.5.2`, `ai@7.0.77`, and `zod@4.4.3`, uses
public imports (including `prefix-safe-json/standard-schema`), and exercises
real `streamText().fullStream` with the official `MockLanguageModelV4`.
CI separately substitutes the current packed candidate for the published PSJ
pin and runs the same five-scenario demo with `ai@7.0.77`, `ai@7.0.128`, and
`ai@7.0.137`, and `ai@7.0.140`. The `7.0.128` pin matches Sandbase's public lockfile snapshot at
`427b52a96a5309ca23268407f85c237468ab6a4e`. The `7.0.128` consumer check covers
complete, truncated, valid-JSON token-limit, schema-invalid, and
projection-mismatch calls; it is narrower than the three exact-major lifecycle
suites above. These are deterministic mock-provider checks, not live-provider,
whole-Sandbase, or independent-adoption evidence.

The same installed consumers run `npm run batch` with two interleaved calls:
complete termination grants two authorities; a token-limited step with one
complete and one truncated call grants neither. The `7.0.137` pin matches
[vercel/ai #22914](https://github.com/vercel/ai/issues/22914). This comparison
checks caller-owned dispatch; it does not cover the requested UI outcomes,
skipped-call states, output budgeting, or continuation features.

All four installed consumers also run `npm run identity`, comparing native
effects with locked, caller-owned effects for distinct IDs (**2 / 2**) and
duplicate IDs (**2 / 0**). The same authored original-stream fixture was
checked locally with installed published PSJ `0.5.2` and `ai@7.0.140`, npm's
latest when checked on 2026-10-14. This is a `streamText()` boundary comparison,
not WorkflowAgent support or an upstream result-pairing fix. See
[the identity trial](IDENTITY_TRIAL.md) for limits and reproduction steps.

`generateText()` returns a non-streaming result with no `fullStream`. The lock
can remove callbacks from its tool definitions, but the raw-stream guard recipe
requires `streamText()` and cannot be reconstructed from parsed `toolCalls`.
See the [AI SDK generateText reference](https://ai-sdk.dev/docs/reference/ai-sdk-core/generate-text).

## Anthropic message completion

The Anthropic adapter requires both `message_delta.delta.stop_reason` and the
final `message_stop` before reporting successful termination. This follows the
[documented Messages streaming sequence](https://platform.claude.com/docs/en/build-with-claude/streaming).
EOF between those events is incomplete even when the tool argument JSON and
its content block are complete. `finish({ reason: "complete" })` cannot replace
the missing event. Duplicate stop metadata and content-block evidence after a
stop reason reject the affected stream's authority.

This correction is included in `0.5.2`; `0.5.1` does not enforce that final
message completion boundary. The regression
is checked with the installed official SDK against a local SSE fixture, not a
live provider.

The [standalone Anthropic consumer](../examples/anthropic-consumer/README.md)
installs published `prefix-safe-json@0.5.2` with `@anthropic-ai/sdk@0.123.0`
outside the checkout. It feeds the SDK's unchanged events to the gate and
checks complete, truncated, token-limited, missing-terminal and post-terminal
argument cases. CI runs the same consumer against the packed candidate.

## Runtime dependencies

No provider adapter imports its vendor SDK's package or types. Every
adapter is a hand-rolled local interface matching the provider's wire
shape, with the evidence for each adapter listed in the matrix above.
This is deliberate: consumers are not forced to install an SDK runtime
dependency through this package. It does not imply every version of every
provider SDK is compatible; only the explicitly tested surfaces are claimed.

## Versioning & stability policy

**Package status: pre-1.0** (the current version is in `package.json`). Per
[Semantic Versioning](https://semver.org/), a pre-1.0 project's public API
is not yet guaranteed stable, and this project takes that seriously rather
than treating `0.x` as a formality:

- **`@public (Stable)`** — exports classified Stable are the ones this
  project's own automated test suite and CI-run examples exercise as the
  primary supported surface (`test/guard/`,
  `test/unit/execution-gate*.test.ts`, `examples/*.mjs`). This is a
  statement about this repository's own maturity/compatibility intent.
  Sandbase provides public dependency and runtime-integration evidence;
  production deployment and independent maintainer-run validation have not
  been confirmed (see `docs/CASE_STUDY_SANDBASE.md`). Currently: `createParser`,
  `createToolCallStreamCoordinator`, `createToolCallExecutionGate`,
  `createAiSdkExecutionGuard`, and their associated types (including the
  pre-existing `toolSchemas`/`schemas` raw-JSON-Schema registration option,
  unchanged in shape since before 0.5.0). Breaking changes to these are
  avoided pre-1.0 and would be called out prominently in `CHANGELOG.md`
  if one became necessary.
- **`@public (Experimental)`** — exported, usable, and tested, but may
  change without a major-version bump while the project is pre-1.0,
  typically because the underlying provider/SDK surface it targets is
  itself still evolving, or because the surface is new and has not yet
  been proven against real external usage. `createAiSdkExecutionLock`
  and its mapped types remain Experimental, matching `src/index.ts`.
  Also Experimental: all six raw provider adapters
  (`OpenAIStreamAdapter`, `OpenAICompatibleStreamAdapter`,
  `AnthropicStreamAdapter`, `GeminiStreamAdapter`, `OpenRouterStreamAdapter`,
  `AiSdkStreamAdapter`); every 0.5.0 validation addition - the
  `validators` registration option, `ToolInputValidator`/
  `ToolValidationResult`, and the `prefix-safe-json/ajv`/
  `prefix-safe-json/standard-schema` adapters (deliberately not marked
  Stable pre-1.0, even though the underlying `toolSchemas`/`schemas`
  behavior they sit alongside already is — see `docs/VALIDATION.md`); and
  `prefix-safe-json/conformance` (the fixture format and runner shape may
  still change, see `docs/CONFORMANCE.md`). Prefer the Stable high-level
  guard/gate API where one exists for your use case; treat every
  Experimental 0.5.0 addition as public experimentation, not yet a
  stabilization commitment - see `docs/V1_CRITERIA.md`.
- **Additive union members are not treated as breaking pre-1.0.** A new
  literal added to a public discriminated-union type (for example,
  `ExecutionReason`/`ToolCallState["status"]` gaining
  `"sdk_execution_observed"` — see `CHANGELOG.md`) is disclosed explicitly
  in the changelog because it can require a downstream **exhaustive**
  `switch`/type-narrowing consumer to add a new case, but it is not itself
  called a SemVer-major change at this stage. Any consumer relying on
  exhaustiveness over a public union should expect this class of change to
  keep happening before 1.0, and ideally use a `default`/fallback case that
  fails safely rather than a bare exhaustive switch with no fallback.
- **Deprecated behavior will be documented before removal where
  practical** — a deprecation notice in `CHANGELOG.md` (and, where it
  affects a specific export, a JSDoc `@deprecated` tag) ahead of an actual
  removal, rather than silent removal, whenever the project can reasonably
  do so.
- This policy describes present intent, not a guarantee stronger than a
  small, pre-1.0 project can actually maintain. It will itself evolve as
  the project approaches 1.0.

### Rejected-push diagnostic retention

Coordinator-owned `E_COORDINATOR_LIMIT_EVENTS`, `E_EVENT_AFTER_STREAM_END`,
and `E_TERMINAL_REASON_CONFLICT` are each retained and queued only on their
first occurrence in a coordinator instance. This changes repeated diagnostic
counts, not the codes, first message/severity, `accepted: false`, or execution
revocation. Queue drains and repeated `finish()` calls do not reset retention.
Provider-supplied and per-call diagnostics are not deduplicated by this rule.
This is a bound on repeated rejected-push records, not a total heap-byte bound.
The deterministic regression is
[`coordinator-rejected-event-retention.test.ts`](../test/unit/coordinator-rejected-event-retention.test.ts).

## ESM / Node / module format

- **ESM only, `require()`-able where Node supports it.** `package.json`
  declares `"type": "module"`, and every `exports` entry has `types`,
  `import` and `default` conditions that point at the same ESM file - there
  is no CommonJS build. `import { createParser } from "prefix-safe-json"`
  works everywhere; CommonJS code can `require("prefix-safe-json")` (and
  every subpath) on runtimes with `require(esm)` - Node 20.19+, 22.12+,
  23+ - and needs dynamic `import()` on older ones. The package has no
  top-level `await`, which `require(esm)` would reject. The packed-runtime
  smoke test checks `require()` on the Node versions that support it.
- **Node `>=18.0.0` package runtime** (`package.json` `engines.node`). The
  distributed ESM/ES2022 output and complete AJV runtime graph were exercised
  from the real `0.4.0` npm tarball on Node 18.20.8, 20.11.1, 22.23.2, and
  24.14.0. Node 18/20 emitted only the expected warning from `0.4.0`'s former
  `>=22` metadata; imports and every smoke path passed without altering the
  tarball. Packed-tarball CI now keeps this runtime claim live across Node
  18/20/22/24.
- **Development/release Node remains 22/24.** Lint, test, mutation, build,
  and exact AI SDK lifecycle jobs are intentionally not forced onto the
  runtime floor. Dev-only packages such as Stryker/Rimraf and the exact
  `ai@7.0.77` proof require newer Node. This does not raise the engine floor
  of the installed `prefix-safe-json` package, which has no runtime dependency
  on `ai`.
- No browser-specific build or bundler-target guarantee is made; the
  package is plain ESM TypeScript output (`dist/*.js` + `.d.ts`) with no
  Node-specific built-ins used in the parser/coordinator/gate/guard core
  (provider adapters are pure data-shape transforms with no I/O of their
  own either — see `SECURITY.md`'s "No network I/O in the library").
