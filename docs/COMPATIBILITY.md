# Compatibility

What follows is scoped strictly to versions and surfaces actually
evidenced by this repository's source, tests, or commit history — not to
what is expected to work by extrapolation. Where no specific SDK package
version has been tested, that is stated explicitly rather than implied.

## Integration matrix

| Integration | Tested version(s) | Target API surface | Status | Raw evidence | Terminal evidence | Caveat |
|---|---|---|---|---|---|---|
| **Vercel AI SDK** (`ai` package) | `ai@5.0.244`, `ai@6.0.264`, `ai@7.0.77`. Lifecycle contract verified against these exact pinned versions; this is not a claim that every version in each major is tested. | `streamText()`/`generateText()`'s `fullStream` (`TextStreamPart<TOOLS>` union) — `tool-input-start`/`-delta`/`-end`, `tool-call`, `tool-result`, `tool-error`, `finish`, `error`, `abort` parts | Stable (`createAiSdkExecutionGuard`), Experimental (`AiSdkStreamAdapter` directly) | Raw `tool-input-delta` text only — the SDK's own resolved `tool-call.input` is read by nothing in this adapter | `finishReason` literal union (`stop`/`length`/`content-filter`/`tool-calls`/`error`/`other`, identical wire vocabulary across all three tested majors) + `abort` part | Does **not** target the lower-level `@ai-sdk/provider` `LanguageModelV3`/`V4` `doStream()` boundary, where `finishReason` is `{ unified, raw }`-object-shaped, not a plain string. Building a provider directly against that interface needs different handling of that field — untested, unsupported by this adapter. |
| **OpenAI** (Chat Completions, legacy `function_call`) | No specific `openai`-package version tested — targets the documented raw SSE delta JSON shape directly, not a specific SDK's generated types | `choices[].delta.function_call` streaming deltas, `finish_reason` | Experimental | Raw `arguments` delta string | `finish_reason: "stop"\|"tool_calls"\|"function_call"\|"length"\|"cancelled"` | Legacy `function_call` shape, not the newer `tool_calls` array shape (see OpenAI-compatible below for that). |
| **OpenAI** (Responses API) | Same as above — verified against `openai-node`'s public `Response`/`ResponseIncompleteEvent` **type definitions**, not a pinned SDK version number | `response.completed`/`response.incomplete`/`response.failed`/`error` events | Experimental | Raw text deltas | `incomplete_details.reason` (`max_output_tokens`\|`content_filter`) | An unrecognized/missing `incomplete_details.reason` normalizes to `unknown`, never assumed complete. |
| **OpenAI-compatible** (generic; also underlies **OpenRouter**) | No specific SDK/version — targets the widely-used `choices[].delta.tool_calls[]` array shape shared by OpenAI's current API and most compatible endpoints | `tool_calls[].function.{name,arguments}` streaming deltas, `finish_reason` | Experimental | Raw `arguments` delta string per tool-call index | `finish_reason` string | "Compatible" describes wire-shape compatibility, not a compatibility claim against any specific vendor's hosted API. |
| **OpenRouter** | No specific SDK/version — thin wrapper over `OpenAICompatibleStreamAdapter`'s shape, plus an `error` field | Same as OpenAI-compatible, plus OpenRouter's own `error` field on a choice | Experimental | Raw `arguments` delta string | `finish_reason` string, or `error` presence | Shares essentially all wire-shape risk with the OpenAI-compatible adapter above. |
| **Anthropic** (Messages API) | No specific SDK/version — targets the documented raw SSE event shape (`content_block_start`/`content_block_delta`/`message_delta`) directly | `input_json_delta.partial_json` deltas on `tool_use` content blocks, `stop_reason` | Experimental | Raw `partial_json` delta string | `stop_reason: "end_turn"\|"tool_use"\|"max_tokens"` | — |
| **Gemini** | No specific SDK/version — targets the documented structured `functionCall` shape | `candidates[].content.parts[].functionCall` (**structured**, not streamed raw JSON text — see caveat) | Experimental | The `args` object as delivered — Gemini's public API returns function-call arguments as an already-parsed structured object, not incremental raw JSON text the way the other five providers do | `finishReason: "STOP"\|"MAX_TOKENS"\|"SAFETY"\|"RECITATION"\|"OTHER"` | Because Gemini does not stream raw JSON text for function-call arguments, this adapter cannot apply the same byte-level prefix-safety analysis the other five providers get — see the adapter's own source comments before relying on it for the same truncation-detection guarantees. |

All five non-AI-SDK adapters are exercised by `test/providers/adapters.test.ts`,
`test/providers/coverage.test.ts`, `test/providers/provider-safety.test.ts`,
and the machine-readable fixture corpus in `test/corpus/provider-envelopes.test.ts`
— real test coverage, just not version-pinned SDK verification the way the
AI SDK adapter is, because none of these five import or type-check against
an actual SDK package (by design — see "Runtime dependencies" below).

## Runtime dependencies

No provider adapter imports its vendor SDK's package or types. Every
adapter is a hand-rolled local interface matching the provider's wire
shape, verified against that provider's published type declarations or API
documentation at the time it was written (see the matrix above for what
"verified" actually means per adapter). This is deliberate: a consumer on
any version of `ai`, `openai`, `@anthropic-ai/sdk`, or a Gemini/OpenRouter
client can use the matching adapter without this package forcing a
specific version of any of them into their dependency graph.

## Versioning & stability policy

**Package status: pre-1.0** (`0.3.0` at the time of writing). Per
[Semantic Versioning](https://semver.org/), a pre-1.0 project's public API
is not yet guaranteed stable, and this project takes that seriously rather
than treating `0.x` as a formality:

- **`@public (Stable)`** — exports classified Stable are the ones this
  project's own automated test suite and CI-run examples exercise as the
  primary supported surface (`test/guard/`,
  `test/unit/execution-gate*.test.ts`, `examples/*.mjs`) — a statement
  about this repository's own maturity/compatibility intent, not a claim
  of external production adoption (see `CHANGELOG.md`'s `2026-08-23`
  correction under `0.1.0` for actual current external-integration
  status). Currently: `createParser`, `createToolCallStreamCoordinator`,
  `createToolCallExecutionGate`, `createAiSdkExecutionGuard`, and their
  associated types. Breaking changes to these are avoided pre-1.0 and
  would be called out prominently in `CHANGELOG.md` if one became
  necessary.
- **`@public (Experimental)`** — exported, usable, and tested, but may
  change without a major-version bump while the project is pre-1.0,
  typically because the underlying provider/SDK surface it targets is
  itself still evolving (currently: all six raw provider adapters —
  `OpenAIStreamAdapter`, `OpenAICompatibleStreamAdapter`,
  `AnthropicStreamAdapter`, `GeminiStreamAdapter`, `OpenRouterStreamAdapter`,
  `AiSdkStreamAdapter`). Prefer the Stable high-level guard/gate API where
  one exists for your use case.
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

## ESM / Node / module format

- **ESM only.** `package.json` declares `"type": "module"` and a single
  `exports["."]` condition set (`types` + `import`) — there is no `require`
  condition and no CommonJS build. `import { createParser } from
  "prefix-safe-json"` (or dynamic `import()` from CommonJS) is the only
  supported consumption path.
- **Node `>=22.0.0`** (`package.json` `engines.node`) — Active LTS lines
  only. Previously `>=18.0.0`; raised because Node 18 and Node 20 both
  reached end-of-life (2025-03-27 and 2026-03-24 respectively — verified
  against nodejs.org's release schedule, not assumed) and no longer receive
  security patches at all. A security-integrity library treating an
  unpatched runtime as a supported baseline was judged indefensible, not a
  cosmetic preference for newer tooling. This is a real compatibility
  narrowing for any consumer still on Node 18/20 — SemVer-relevant even
  though no public API changed (see the versioning policy above: pre-1.0,
  shipped as a normal minor). CI matches this exactly (Node 22, 24 ×
  Linux/Windows/macOS). Not tested against earlier Node major versions.
- No browser-specific build or bundler-target guarantee is made; the
  package is plain ESM TypeScript output (`dist/*.js` + `.d.ts`) with no
  Node-specific built-ins used in the parser/coordinator/gate/guard core
  (provider adapters are pure data-shape transforms with no I/O of their
  own either — see `SECURITY.md`'s "No network I/O in the library").
