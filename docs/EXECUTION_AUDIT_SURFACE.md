# Execution-critical audit surface

The library returns decisions; it does not execute tools. “Can grant” below
means “can create or release an `ExecuteDecision` to caller code,” not “runs a
side effect.”

## First independent review package: stream termination authority

### Scope and files

Review the complete terminal-evidence path, not the whole parser:

- `src/providers/ai-sdk.ts` — maps SDK finish, error, abort, and tool events;
- `src/coordinator/coordinator.ts` — owns terminal state and rejects late or
  conflicting lifecycle evidence;
- `src/gate/decide.ts` — the only positive decision constructor;
- `src/gate/gate.ts` — freezes decisions and releases one-shot authority.

Focused tests:

- `test/guard/ai-sdk-compatibility.test.ts`;
- `test/providers/ai-sdk-adapter.test.ts`;
- `test/unit/coordinator-error-paths.test.ts`;
- `test/unit/coordinator-executable-policy.test.ts`;
- `test/unit/execution-gate-decision-table.test.ts`;
- `test/unit/execution-gate.test.ts`;
- `test/integration/authority-boundaries.test.ts`.

### Threat model and invariant

Assume provider/SDK lifecycle events are malformed, reordered, duplicated,
conflicting, truncated, or adversarial, while caller-owned tools may cause
irreversible side effects.

**Invariant:** execution authority must never be produced unless the relevant
tool call has trustworthy positive terminal evidence. Missing, malformed,
unsafe, late, conflicting, ambiguous, or duplicated lifecycle evidence must
not upgrade an unsafe call into an executable one.

### Attack ideas

Exercise terminal-before-final-delta, missing terminal, unknown terminal
reason, duplicate/conflicting terminal events, post-terminal argument or
identity mutation, provider error, abort, content filter, length termination,
interleaved parallel calls, and identity changes around terminal events.
Existing tests cover examples of every listed class, but the reviewer should
vary ordering and attribution independently rather than treating those tests
as proof of completeness.

### Focused commands and expected output

```console
pnpm vitest run test/guard/ai-sdk-compatibility.test.ts test/providers/ai-sdk-adapter.test.ts test/unit/coordinator-error-paths.test.ts test/unit/coordinator-executable-policy.test.ts test/unit/execution-gate-decision-table.test.ts test/unit/execution-gate.test.ts test/integration/authority-boundaries.test.ts
pnpm run test:coverage
```

Return a short Markdown report containing: reviewed commit SHA, invariant
verdict, event-order matrix, reproducible failing tests for every finding,
severity/rationale, and any unreviewed assumptions. A pass should say only
what was examined; it must not be presented as a whole-codebase audit.

## Smallest authority core

There are two direct authority files:

| Source / symbol | Responsibility | Direct dependencies | Can grant? | Primary tests |
| --- | --- | --- | --- | --- |
| `src/gate/decide.ts` — `decideExecution` | Exhaustive fail-closed terminal decision table. Its `complete` case is the only branch that constructs `action: "execute"`. | coordinator state/diagnostics and gate types | **Yes: creates the positive decision** | `test/unit/execution-gate-decision-table.test.ts`, `test/guard/decision-evidence.test.ts`, `test/integration/authority-boundaries.test.ts` |
| `src/gate/gate.ts` — `DefaultToolCallExecutionGate.finish`, `takeDecision` | Freezes final decisions and releases a matching execute decision only after finish and at most once per internal call ID. | coordinator and `decideExecution` | **Yes: sole one-shot release point** | `test/unit/execution-gate.test.ts`, `test/integration/authority-boundaries.test.ts` |

Review these first. A positive result is trustworthy only if the evidence fed
to them is trustworthy, so continue through the relevant path below.

## Evidence and ownership path

```text
createAiSdkExecutionLock
  -> strips SDK-owned callbacks / rejects ambiguous execution locations

AI SDK fullStream
  -> AiSdkStreamAdapter
  -> createProviderExecutionGuard
  -> ToolCallExecutionGate
     -> ToolCallStreamCoordinator
        -> IncrementalJsonParser
           -> UTF-8 -> lexer -> grammar -> semantic snapshot
        -> Ajv schema validation
        -> identity/protocol/SDK-execution diagnostics
     -> decideExecution
     -> takeDecision(internalId) exactly once
  -> caller-owned side effect
```

| Source / symbol | Evidence or control responsibility | Can grant directly? | Relevant tests |
| --- | --- | --- | --- |
| `src/guard/ai-sdk-execution-lock.ts` — `createAiSdkExecutionLock` | Removes `execute` and input callbacks, forces approval, rejects function descriptions and provider-executed/ambiguous shapes. | No; prevents competing authority. | `test/guard/ai-sdk-execution-lock.test.ts`, `test/integration/ai-sdk-lifecycle/*.test.ts` |
| `src/providers/ai-sdk.ts` — `AiSdkStreamAdapter.push`, `finish` | Maps raw AI SDK argument deltas, IDs, terminal reasons, tool results/errors, and protocol evidence. | No. | `test/providers/ai-sdk-adapter.test.ts`, `test/guard/ai-sdk-compatibility.test.ts`, lifecycle tests |
| `src/guard/ai-sdk.ts` — `createAiSdkExecutionGuard` | Thin public AI SDK composition wrapper. | No; delegates. | `test/guard/ai-sdk-guard.test.ts` |
| `src/guard/provider-guard.ts` — `createProviderExecutionGuard` | Feeds adapter events to the gate and exposes the gate's one-shot method. | No new decision logic; forwards the gate result. | `test/guard/provider-guard.test.ts` |
| `src/coordinator/coordinator.ts` — `DefaultToolCallStreamCoordinator` | Accumulates raw arguments, owns call identity/state, detects ordering/identity/SDK execution violations, finishes parsers, and compiles/runs Ajv validators. | No; produces evidence and parser-level `executable`. | `test/unit/coordinator*.test.ts`, `test/integration/authority-boundaries.test.ts` |
| `src/parser.ts` — parser `push`, `snapshot`, `finish` | Determines byte-accurate raw accumulation, syntactic completeness, truncation, stable values, repair accounting, and parser-level executability. | No; parser executability is not tool authority. | parser, invariants, corpus, fuzz, and mutation tests |
| `src/utf8/decoder.ts` | Rejects invalid/split UTF-8 and preserves byte accounting. | No. | `test/unit/utf8.test.ts` |
| `src/lexer/scanner.ts`, `src/lexer/states.ts`, `src/lexer/tokens.ts` | Token completeness and lexical diagnostics. | No. | scanner tests and mutation tests |
| `src/grammar/stack.ts`, `src/grammar/frame.ts`, `src/grammar/pointer.ts` | Container completion, grammar state, and pointer identity. | No. | grammar stack/frame/pointer tests |
| `src/semantic/builder.ts`, `src/semantic/snapshot.ts` | Commits only complete values and constructs stable snapshots. | No. | semantic/invariant/parser tests |
| `src/coordinator/diagnostic-codes.ts`, `src/diagnostics/codes.ts`, `src/diagnostics/factory.ts`, `src/limits.ts` | Machine-readable fail-closed evidence and resource-limit definitions. | No, but changing codes/limits can change classification. | decision-table, diagnostic-shape, resource-limit tests |

Type/protocol contracts in `src/types.ts`, `src/coordinator/types.ts`,
`src/coordinator/protocol.ts`, `src/gate/types.ts`, `src/guard/types.ts`, and
`src/providers/adapter.ts` complete the conservative static dependency closure.

For low-level provider use, add only the adapter actually receiving untrusted
events:

- `src/providers/openai.ts` and `src/providers/openai-compatible.ts`;
- `src/providers/openrouter.ts` plus `openai-compatible.ts`;
- `src/providers/anthropic.ts`;
- `src/providers/gemini.ts` (projection-only arguments cannot gain strict
  execution authority).

## Surface size and refactor decision

- Before this audit: the trust boundary was implicit across all 34 emitted
  source modules.
- After this audit: the direct authority core is 2 files. The conservative
  AI SDK static closure is 27 files including type-only contracts and the
  execution lock. Other providers require their selected adapter path.
- Runtime refactor: **none**. The decision table and one-shot release point
  were already centralized. Moving parser/evidence logic merely to reduce a
  file count would increase coupling and make the review less legible.

This count is intentionally conservative. Do not audit only the two authority
files when adversarial raw events, parser bugs, identity ambiguity, schema
validation, or terminal mapping are in scope.

## Dist correspondence

The TypeScript build emits one `dist/**/*.js`, one `.d.ts`, and corresponding
maps for each of the 34 `src/**/*.ts` files. Each JavaScript source map names
exactly one source path and embeds no source text. Use tag `v0.4.2` plus
[`RELEASE_INTEGRITY.md`](RELEASE_INTEGRITY.md) to bind those source paths to
the published bytes. (`v0.4.2`'s `dist/` is verified byte-identical to
`v0.4.1`'s — see `RELEASE_INTEGRITY.md` — so this source-to-dist mapping is
unchanged from the prior release.)
