# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
See [RELEASE.md](RELEASE.md) for the quantitative bar (mutation score,
coverage) a version bump requires.

## [Unreleased]

## [0.4.3] - 2026-08-28

Security patch. Fixes an execution-integrity defect where lifecycle
evidence arriving after a stream's own terminal could fail to invalidate
a decision by the time `takeDecision()` released it, and where an AI SDK
event carrying conflicting `id`/`toolCallId` values was resolved by
silently preferring one instead of failing closed. Reported through
private vulnerability disclosure; see GHSA-3xpw-9694-2xxp for the
published advisory once it is available.

### Security

- `takeDecision()` now re-derives its decision from the coordinator's
  current diagnostics on every call, instead of trusting the snapshot
  frozen at `finish()` time. Contradictory or late evidence observed
  after `finish()` but before one specific call's authority is consumed
  now correctly revokes it; `finish()` having been called at least once
  remains required before any authority is available at all.
- `AiSdkStreamAdapter.push()` no longer discards every event once the
  stream has already reported its own terminal. Post-terminal input
  (a late argument delta, provider error, abort, a conflicting or
  duplicate terminal, or SDK `tool-result`/`tool-error` evidence) still
  reaches the coordinator, and the coordinator's own post-terminal
  diagnostics are now part of the set that disqualifies execution
  authority rather than being merely observable.
- A raw AI SDK event carrying both `id` and `toolCallId`, present and
  unequal, now fails the whole stream closed with a diagnostic instead
  of silently preferring `id`. Equal or single-field identity is
  unaffected.

Affected: every published release through 0.4.2. Patched: 0.4.3. No
public API change - `ExecuteDecision`/`NonExecutableDecision` shapes,
`ToolCallExecutionGate`/`AiSdkExecutionGuard` method signatures, and
every existing diagnostic code are unchanged. Upgrade is recommended
for every user of `createAiSdkExecutionGuard()` or the lower-level
`createToolCallExecutionGate()`/`AiSdkStreamAdapter` composition.

## [0.4.1] - 2026-08-25

Publishes the already-merged package-runtime compatibility widening. This is
a mechanical patch release: runtime behavior, public API, dependencies, and
security guarantees are unchanged.

### Compatibility

- Package runtime support is widened from Node `>=22.0.0` to `>=18.0.0`,
  verified by executing the packed package on Node 18, 20, 22, and 24.
- Development and release tooling remains on newer Node versions where
  required. AI SDK lifecycle compatibility remains scoped to the exact tested
  versions rather than implying universal SDK compatibility.
- Node 18 and Node 20 are end-of-life and are not recommended production
  runtimes; compatibility does not imply that they receive security fixes.

## [0.4.0] - 2026-08-25

Publishes the execution-authority hardening and adoption-readiness work
merged since `0.3.0`. The documented AI SDK golden path now keeps local
execution in caller-owned manual dispatch, backed by exact runnable lifecycle
proofs and required corpus validation. The release does not extend its claims
beyond the explicitly tested boundaries below.

### AI SDK adoption

- Documented the safe ownership boundary as the golden path: lock tool
  definitions with `createAiSdkExecutionLock()`, feed the real `fullStream`
  into `createAiSdkExecutionGuard()`, and dispatch only authority consumed
  through `takeDecision()`.
- Added a deterministic, runnable lifecycle proof against the exact pins
  `ai@5.0.244`, `ai@6.0.264`, and `ai@7.0.77`. This verifies those versions
  only; it is not a claim of universal compatibility across the three majors.
- Made canonical provider-corpus validation a required gate in both CI and
  release workflows.

### Security

- Gemini structured argument projections are now inspection-only and reject
  strict execution authority with `projection_only`.
- AI SDK start/delta/end ordering violations are recorded as sticky,
  source-scoped protocol poison; later valid parts cannot erase them.
- OpenAI-compatible/OpenRouter tool identity now includes explicit
  `choice.index` plus tool index. Missing, invalid, or duplicate choice
  identity fails closed.
- Added call-scoped `takeDecision(internalId)`, a one-shot execution-authority
  path. `finish()` remains replayable for diagnostics; application
  authorization and durable idempotency remain caller-owned.

### Guarantee boundary

- Application authorization and durable or distributed idempotency remain
  caller-owned; one-shot authority is scoped to a guard instance and is not a
  distributed exactly-once guarantee.
- Provider-executed tools remain outside the local execution guarantee.

## [0.3.0] - 2026-08-24

Closes the execution-ownership gap `0.2.0`'s `sdk_execution_observed`
detection could only ever catch after the fact: `createAiSdkExecutionLock()`
now stops the *first* execution across `ai@5`/`ai@6`/`ai@7`, verified
against each major's own real source rather than published types or
analogy. Also includes terminal-evidence forensic hardening, a real
dependency-security fix, a Node support-policy correction, and a real
release-authorization gap closed (any version-changing merge to `main`
could previously auto-publish with no separate human confirmation).
0.3.0 rather than a patch, for two independent reasons, either alone
sufficient under this project's own pre-1.0 precedent (see
`docs/COMPATIBILITY.md`'s versioning policy): a new public export
(`createAiSdkExecutionLock` plus `LockedAiSdkTool`/`LockedAiSdkTools`,
additive but real new Experimental surface), and a real Node-version
compatibility narrowing (`>=18.0.0` → `>=22.0.0` — some consumers can no
longer install this cleanly).

### Execution ownership

- **`createAiSdkExecutionLock()`** (new, `@public (Experimental)`): wraps AI
  SDK tool definitions so the SDK's own tool loop cannot invoke real caller
  code before this library's gate reaches a decision. Removes `execute`
  and every SDK-invoked pre-decision input-lifecycle callback -
  `onInputStart`, `onInputDelta`, `onInputAvailable` - not just `execute`
  alone: verified directly against `ai@5`/`ai@6`/`ai@7`'s own real source
  that all three fire in a transform stream entirely independent of
  `needsApproval`/approval status, so forcing `needsApproval: true` alone
  does **not** stop them. Also forces `needsApproval: true` unconditionally,
  which still closes the `execute` gap specifically on `ai@6`+ via the
  SDK's own approval mechanism (a no-op on `ai@5`, which has no such
  mechanism). Also rejects, rather than silently accepting: a
  function-valued `description` (`ai@7`+ invokes it during tool
  preparation, before the model call begins - arbitrary caller code on the
  same pre-decision timeline as the callback trio); and any provider tool
  shape whose real execution location cannot be verified from the object
  alone - `isProviderExecuted: true`, `ai@6`'s discriminator-less
  `{ type: "provider" }`, and `ai@5`'s discriminator-less `{ type:
  "provider-defined" }` are all rejected, while `ai@7`'s `{ type:
  "provider", isProviderExecuted: false }` is accepted (verified to have no
  `execute` field at all on that shape, so the SDK can never auto-run it).
  New exported mapped types `LockedAiSdkTool<T>`/`LockedAiSdkTools<TTools>`
  give the return value a real type - the five affected fields do not exist
  on a locked tool's type at all, not merely optional-and-absent. A tool
  that bypasses the wrapper entirely and attaches `execute`/the callback
  trio directly remains unprotected on every major; the pre-existing
  `sdk_execution_observed` detection remains the real backstop for a
  bypassed `execute` specifically, with no equivalent for a bypassed
  `onInputStart`/`onInputDelta`/`onInputAvailable`. This function is not a
  sandbox for a tool definition's *other* fields - a schema library's own
  validation/refinement/transform machinery is caller-provided executable
  code this library does not run, remove, or guard. Real execution is
  unchanged: still driven manually from `guard.finish().decisions`. See
  `docs/EXECUTION_GATE.md#closing-the-first-execution-gap-createaisdkexecutionlock`.

### Real AI SDK lifecycle evidence

- New integration test layer (`test/integration/ai-sdk-lifecycle/`, 27
  tests) drives actual `streamText()` calls from the real `ai` package
  (`ai@5.0.244`, `ai@6.0.264`, `ai@7.0.77`, installed side-by-side via pnpm
  aliases) against each major's own provider-boundary test double — real
  argument buffering, real tool-call construction, real `needsApproval`
  resolution, real execute-gating. Not hand-built `fullStream` event
  objects (the pre-existing `test/guard/ai-sdk-compatibility.test.ts` and
  friends, which remain and still matter as fast synthetic contract
  coverage). Proves, with a real irreversible-operation counter: safe
  calls execute exactly once (manually, post-`finish()`); a
  finish-reason-length, truncated-with-a-provider-side-"repaired"-input,
  provider-error, aborted-mid-stream, or schema-invalid call never
  executes; concurrent safe+unsafe calls are isolated; a reused
  `toolCallId` across two isolated guard instances does not cross-resolve;
  and — reported as honestly as the fix — an unlocked native `execute`
  still fires exactly as unprotected as before, on every major.

### Terminal evidence hardening

- **Coordinator**: a second `provider_stream_end` arriving after the
  stream already finished with a *genuinely conflicting* reason (e.g.
  `"complete"` then `"abort"`) now gets its own diagnostic,
  `E_TERMINAL_REASON_CONFLICT` (`severity: "fatal"`), distinct from the
  generic `E_EVENT_AFTER_STREAM_END` any other post-finish event gets —
  forensic signal, not a second chance to change the decision (which was
  already structurally impossible: the coordinator's `isFinished` gate and
  every call's `status !== "collecting"` guard already made execution
  confidence unable to increase after the fact, reconfirmed by tracing the
  existing code rather than assumed).

### Security

- **`nanoid@3.3.16`** (`GHSA-2v37-7h3g-55p8`, high) — a transitive
  `devDependency` via `vite`'s own `postcss` dependency, found while
  installing the real AI SDK majors above, unrelated to the
  vitest/vite/esbuild/qs remediation already shipped. Forced to `^3.3.18`
  via the same `pnpm.overrides` mechanism already in use.

### Node support policy

- **`engines.node`**: `>=18.0.0` → `>=22.0.0`. Node 18 and Node 20 both
  reached end-of-life (2025-03-27 and 2026-03-24 respectively — verified
  against nodejs.org's release schedule, not assumed) and no longer
  receive security patches; a fail-closed execution-integrity library does
  not treat an unpatched runtime as a defensible baseline. CI/publish Node
  matrices: `[18, 20, 22]` → `[22, 24]` (the current Active LTS lines). A
  real compatibility narrowing for any consumer still on Node 18/20 —
  disclosed as SemVer-relevant even though no public API changed. See
  `docs/COMPATIBILITY.md`.

### CI / release / governance

- **`publish.yml`**: the `publish` job now requires the `npm-publish`
  GitHub Environment (a real, required-reviewer-protected environment,
  restricted to `main`, with a repository-admin bypass kept as an
  emergency escape hatch). Previously, any push to `main` that happened to
  change `package.json`'s version to an unpublished value — intentional
  release or accidental — published automatically the moment the existing
  validation gates passed, with no separate human confirmation beyond
  whatever review the merge itself got. The four validation jobs
  (test-matrix, coverage, mutation, fuzz) are unaffected and still run
  automatically on every version-changing push.
- **`main` branch protection**: previously entirely unprotected (`gh api
  repos/.../branches/main` reported `protected: false`, no rulesets).
  A new ruleset requires PRs (0 required approving reviews — a solo
  maintainer has no second reviewer; this is deliberately about forcing
  the PR+CI discipline, not bureaucracy), disables force-push and branch
  deletion, and requires the current CI check set (the Node 22/24 × OS
  matrix, Coverage, Dependency Review, CodeQL) before merge, with a
  repository-admin bypass so a solo maintainer can't be permanently
  deadlocked by their own rule.
- **CI**: new `package-smoke` job packs a real tarball and installs it into
  isolated JS and TS consumer projects on every PR/push — previously this
  level of clean-room verification only happened in `publish.yml`'s own
  release path, so a packaging regression was only caught the moment a
  release was already being attempted.
- **Trusted Publishing**: still preparation only, unchanged from `0.2.0` —
  `npm whoami` in this environment still returns `401` (no authenticated
  npm identity available here at all), so npm-account-side Trusted
  Publisher registration could not be performed or verified. Not claimed
  as enabled.

### Documentation

- `RELEASE.md` rewritten to describe the actual automated release process
  (previously described a stale manual checklist — hand-run tests, `git
  tag` + `git push --tags`, "publish via CI or manually"). Also resolves a
  real inconsistency it had: benchmarks were listed as a checklist item
  indistinguishable from the real blocking gates (mutation/coverage/fuzz)
  next to them, but no workflow has ever run or gated on `npm run bench`.
  No benchmark baseline is committed anywhere in this repository to
  compare a run against, so a pass/fail threshold would have been
  fabricated rigor; documented explicitly as informational instead.
- `docs/THREAT_MODEL.md`: explicitly distinguishes *decision integrity*
  (is the verdict trustworthy) from *execution ownership* (does the
  verdict actually control whether the real operation runs), now that
  `ai@6`+ has a configuration where those coincide.
- `docs/EXECUTION_GATE.md`, `README.md`: document
  `createAiSdkExecutionLock()` as the strongest available execution-
  ownership option, ordered ahead of the pre-existing "omit `execute`"
  pattern per its real guarantee strength — the `ai@5` limitation is
  stated as plainly as the `ai@6`/`ai@7` guarantee, not buried under it.
- `docs/COMPATIBILITY.md`: corrected a stale `0.1.1 at the time of
  writing` version reference (now `0.2.0`); `ProviderStreamAdapter`
  (previously carrying no `@public` classification comment at all under
  strict TSDoc parsing) is now explicitly `@public (Experimental)`,
  matching the adapters that implement it.
- `.github/workflows/scheduled-checks.yml`: the full dependency-audit
  step's comment described vite/vitest/esbuild/nanoid/qs as known,
  unfixed devDependency advisories — all five were remediated (four in
  the prior dependency-security release, nanoid above); rewritten to
  describe what the step is actually for going forward rather than a
  now-stale historical snapshot.

## [0.2.0] - 2026-08-23

Substantial execution-integrity hardening plus a public API surface
expansion, documentation/trust corrections, and CI/supply-chain
hardening. Pre-1.0 (see `docs/COMPATIBILITY.md`'s versioning policy);
0.2.0 rather than 0.1.2 specifically because of the `sdk_execution_observed`
union expansion documented under "API compatibility" below — additive at
runtime, but a real source-compatibility consideration for downstream
exhaustive `switch` consumers, which this project treats as more than a
patch-level change even pre-1.0.

### Execution integrity

- **guard**: `createAiSdkExecutionGuard()`/`AiSdkStreamAdapter` now detect
  when the Vercel AI SDK's own tool loop already invoked a call's `execute`
  callback — proof that execution authority already left this library's
  hands, independent of whatever the call's arguments or the stream's
  finish reason look like. A `tool-result` part (the callback returned,
  including a no-op implementation) and a `tool-error` part (it threw) get
  identical treatment: neither proves the absence of a partial side effect,
  so both fail closed the same way.
  - **Attributed** evidence (a real `toolCallId`) poisons only that
    specific call, immediately and irreversibly: `ToolCallState.status`
    becomes `"sdk_execution_observed"` the moment the evidence arrives,
    mid-stream, and no later event for that call can move it back.
  - **Unattributable** evidence (no usable `toolCallId`) cannot be
    guessed onto one call without risking the opposite failure mode
    (the real target stays free to execute while an unrelated call is
    wrongly punished) — so it fails closed for **every** call the gate
    ever decides in that guard/coordinator instance, including a call
    that starts after the evidence arrives. Evidence never crosses
    guard/coordinator instances.
  - `sdk_execution_observed` has the highest rejection-reason priority of
    any disqualifier — it is checked, and wins, before `resource_limit`,
    `provider_error`, `content_filtered`, and every structural
    truncation/malformedness case. Those are all statements about the
    arguments or stream being unusable, safe to retry at a caller's
    discretion; `sdk_execution_observed` is a statement that execution
    already happened, which a caller must never retry the same way.
  - This closes a real gap, not a theoretical one: previously an
    unattributable `tool-result`/`tool-error` was recorded as a
    diagnostic but never consulted by the decision logic, so an
    unrelated in-flight call could still be reported `action: "execute"`
    even though the SDK had already run *some* call in that same stream.
  - As before this cannot undo a side effect the SDK's own callback
    already produced — it only prevents this library from *also*
    authorizing a second, caller-driven execution of it. See
    `docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence`
    and `docs/THREAT_MODEL.md`.

### API compatibility

- **`ExecutionReason`** (`src/gate/types.ts`) and **`ToolCallState["status"]`**
  (`src/coordinator/types.ts`) both gain one new literal:
  `"sdk_execution_observed"`. This is additive at the value/runtime level —
  existing code that only reads/compares specific known literals is
  unaffected — but it is breaking-*shaped* for any downstream consumer with
  an **exhaustive** TypeScript `switch`/type-narrowing over either union
  (e.g. `switch (reason) { case "complete": ...; case "truncated": ...; }`
  with no `default`): such code will need a new case added, or it will fail
  to compile under `noImplicitReturns`/exhaustiveness checking, or silently
  fall through a `default` if one exists. This is not being called a
  SemVer-major change: the project is pre-1.0, and per the versioning
  policy in `docs/COMPATIBILITY.md`, additive union members on public
  discriminated-union reason/status types are treated as a normal minor
  change at this stage, not a breaking one — but it is disclosed explicitly
  here because it is a real source-compatibility consideration for anyone
  exhaustively switching on these types, whatever the version number says.
- **`AiSdkStreamAdapter`** now also normalizes the `tool-result` fullStream
  part (previously silently ignored) into a `provider_diagnostic`, and the
  existing `tool-error` handling now shares its diagnostic code constant
  with the new `tool-result` handling internally. No change to
  `AiSdkStreamAdapter`'s own public shape or `@public (Experimental)`
  classification.

### Documentation

- **README/`docs/EXECUTION_GATE.md`**: documented the safe AI SDK
  integration pattern precisely — never attach a native `execute` callback
  (not even a no-op one) to a tool definition whose real operation this
  library is meant to gate, because the SDK's own tool loop invoking it at
  all (regardless of what it returns) is exactly the evidence described
  above. Previously said "or a no-op one" was an acceptable alternative to
  omitting `execute` entirely; corrected, since a no-op callback is still a
  real callback the SDK invokes and still produces `tool-result`.
- **`docs/THREAT_MODEL.md`** (new): security objective, trust boundaries,
  and an explicit guarantees/non-guarantees list for the parser →
  coordinator → gate → caller pipeline.
- **`docs/COMPATIBILITY.md`** (new): per-integration compatibility matrix
  (tested versions, targeted API surface, status, caveats) and the
  project's ESM/Node/SemVer/Stable-vs-Experimental policy in one place.
- **`src/index.ts`**: every provider adapter export now carries its own
  individually-attached `@public (Experimental)` JSDoc comment. Previously
  one comment block visually preceded all six `export { ... }` statements
  for the provider adapters, but a JSDoc/TSDoc comment attaches only to the
  single declaration immediately following it — five of the six adapters
  (`OpenAICompatibleStreamAdapter`, `AnthropicStreamAdapter`,
  `GeminiStreamAdapter`, `OpenRouterStreamAdapter`, `AiSdkStreamAdapter`)
  had no individually-attached classification at all under strict
  TSDoc/TypeDoc parsing, only `OpenAIStreamAdapter` did. `DEFAULT_LIMITS`,
  `DiagnosticCode`, and `CONTENT_FILTERED_DIAGNOSTIC_CODE` — value exports
  with no classification comment at all — now have one too.
- **`experiments/**`** (20 files, 5 targets: `vercel-ai`, `mastra`,
  `stagehand`, `goose`, `langchainjs`) removed entirely. Every claimed
  commit SHA, upstream file path, and benchmark number was checked
  directly against the real repositories (`vercel/ai`, `mastra-ai/mastra`,
  `browserbase/stagehand`, `block/goose`, `langchain-ai/langchainjs`) —
  none of it held up: no claimed commit resolves (one claimed hash isn't
  even valid hexadecimal), most claimed file paths don't exist, and the
  benchmark numbers fall in the same range a prior cleanup already found
  fabricated once (see `[0.0.1-alpha.0]` below). Deleted rather than
  rewritten into plausible-sounding replacements; git history preserves
  what was removed.

### External adoption correction

The `[0.1.0]` entry below originally described three external codebases
as "integrated," past tense; a dated correction is attached directly to
that entry and is not reproduced verbatim here to avoid two slightly
different copies drifting apart. Restated at the level that matters for
this release: [dyad-sh/dyad#4341](https://github.com/dyad-sh/dyad/pull/4341)
and [op7418/CodePilot#676](https://github.com/op7418/CodePilot/pull/676)
are real, substantive, but **open and unmerged** PRs proposing a
`prefix-safe-json` dependency — not shipped or production integrations.
[apache/maka#3434](https://github.com/apache/maka/pull/3434) validates
the same execution-integrity problem class this package addresses, but
its own PR text states plainly that it uses a Maka-owned native
implementation with **no** `prefix-safe-json` dependency at all. None of
the three should be read as a merged, production adoption of this
package.

### CI / supply-chain

- **CodeQL** (`codeql.yml`, new): static analysis on push/PR/weekly
  schedule.
- **Dependency Review** on PRs (`ci.yml`).
- **Coverage gate**: `vitest.config.ts` now enforces `>=95%` on
  statements/branches/functions/lines as a dedicated, required CI job —
  previously measured but not gated in CI.
- **Mutation gate**: `stryker.config.json`'s `thresholds.break: 85.01`
  (the smallest value making Stryker's `score < break` check equivalent
  to a strict `>85%` bar) — enforced ahead of any release publish and in
  a weekly scheduled run.
- **Scheduled checks** (`scheduled-checks.yml`, new): extended fuzz soak,
  mutation testing, and a production-vs-dev-only dependency audit split
  (`pnpm audit --prod --audit-level=high` blocking; a full audit
  including devDependencies is informational-only, since pre-existing
  dev-only advisories don't affect the published tarball).
- Every GitHub Actions step across every workflow is pinned to a full
  commit SHA; every job declares least-privilege `permissions:`; zero
  `pull_request_target` anywhere.
- **`publish.yml` hardening**: a cheap `release-intent` preflight
  (fail-closed on any non-`E404` npm lookup error — never assumes a
  version is unpublished on an ambiguous failure) gates the expensive
  3×3 matrix/coverage/mutation/10+-minute release-fuzz jobs so they only
  run for an actually-unpublished version; a second exact-version
  recheck runs immediately before the real `npm publish` call, closing
  the TOCTOU window the ~30+ minute gate chain otherwise leaves open;
  provenance (`--provenance`) preserved; installed-tarball consumer
  smoke test preserved and extended to exercise
  `sdk_execution_observed`.
- **Trusted Publishing: preparation only.** The publish job pins the npm
  CLI to the exact version (`11.5.1`) npm requires for OIDC-based Trusted
  Publishing. `NODE_AUTH_TOKEN`/`secrets.NPM_TOKEN` remains the actual
  publish auth path in this release — registering this package as a
  Trusted Publisher on npm's website is a separate, human, account-side
  action not completed by this release.

## [0.1.1] - 2026-08-22

**Fixes a broken `0.1.0` publish.** `0.1.0`'s package on npm shipped with no
`dist/` directory at all and could not be imported
(`ERR_MODULE_NOT_FOUND: .../dist/index.js`). `0.1.0` is deprecated on npm
pointing here; `latest` now resolves to this version.

Root cause: `.github/workflows/publish.yml`'s `publish` job runs on its own
fresh runner with its own checkout — nothing built by `test-matrix` (a
separate job in the same workflow) is shared with it, and `dist/` is
gitignored. The commit that shipped `0.1.0` had removed `publish`'s own
`Build` step, reasoning it was redundant with `test-matrix`'s build — true
for typecheck/lint/test, false for build, since `publish` is the only job
whose output actually gets packed and published. `npm publish` happily
packed and published whatever existed in that job's checkout, which was no
`dist/` at all.

Fix: restored `publish`'s own `Typecheck`/`Lint`/`Test`/`Build`/examples/
`Pack check` steps (still gated behind `needs: test-matrix` as an
additional, not a replacement, requirement), and added a new hard gate —
`Installed-tarball import smoke test` — that runs `npm pack`, installs the
resulting tarball into a scratch project exactly the way a real consumer
would, imports the four top-level factory exports, and runs one real parse
through `createParser()`. Verified locally both ways: passes against a
correctly-built tree, and fails loudly (`ERR_MODULE_NOT_FOUND`, non-zero
exit) when `dist/` is removed — reproducing the exact `0.1.0` failure.

No source or public-API changes from `0.1.0`.

## [0.1.0] - 2026-08-22

First non-alpha release. No API changes from `0.0.1-alpha.4` — this release
drops the `alpha` prerelease tag after the package had already been
integrated against three independent real-world codebases (Dyad, CodePilot,
Apache Maka) across separate PRs without needing a single signature change
to the public API. Still pre-1.0: a future breaking change remains possible
and will be called out here, but the "under active development, do not use
in production" caveat no longer reflects the package's actual state.

> **Correction (2026-08-23):** The paragraph above overstates what had
> actually happened. All three were, and as of this correction still are,
> **open, unmerged pull requests** — not merged, shipped, or production
> dependencies, and "integrated" above should not have been past tense.
> Only two of the three actually propose using `prefix-safe-json` as a
> dependency: **Dyad** and **CodePilot**. **Apache Maka**'s PR validates
> the same execution-integrity problem class but uses a Maka-owned native
> implementation and does **not** depend on `prefix-safe-json` at all — it
> should not have been grouped with the other two as if it were. Verified
> directly against the live PRs rather than assumed:
>
> - **Dyad** — [dyad-sh/dyad#4341](https://github.com/dyad-sh/dyad/pull/4341)
>   (open, not merged): a real, substantive PR pinning
>   `prefix-safe-json@0.0.1-alpha.4` and using its AI SDK stream adapter to
>   gate Dyad's auto-apply path on confirmed-safe stream termination.
> - **CodePilot** — [op7418/CodePilot#676](https://github.com/op7418/CodePilot/pull/676)
>   (open, not merged): a real, substantive PR installing
>   `prefix-safe-json@0.0.1-alpha.4` from the public npm registry and using
>   `createAiSdkExecutionGuard()` to defer a shell-executing tool's real
>   side effect until the stream's terminal state is confirmed safe.
> - **Apache Maka** — [apache/maka#3434](https://github.com/apache/maka/pull/3434)
>   (open, not merged): validates the identical problem class this package
>   exists for — gating tool execution on raw stream completion, not just
>   JSON validity — but explicitly does **not** depend on this package. The
>   PR's own description states plainly that it "adds no new runtime
>   package, no `prefix-safe-json` dependency"; the execution-safety logic
>   is a Maka-owned native implementation. Grouping Maka with the other two
>   as if it were also a dependency adopter was incorrect.
>
> This note corrects the framing rather than silently editing the original
> paragraph, which is left as written above because it reflects what was
> believed (incorrectly) at release time. PR status (open/merged) can
> change after this correction was written — re-check the linked PRs
> directly for current status rather than trusting this note indefinitely.

### Changed

- **package**: version `0.0.1-alpha.4` → `0.1.0`. Drops the `alpha`
  prerelease tag; the published `README.md` no longer carries the "do not
  use in production" warning.
- **guard**: `createAiSdkExecutionGuard()` promoted from `@public
  (Experimental)` to `@public (Stable)` in both `src/index.ts` and
  `src/guard/ai-sdk.ts`'s own doc comment. The raw provider adapters
  (`OpenAIStreamAdapter` and siblings) remain `@public (Experimental)` —
  this release does not claim stability for surface this library's own real
  integrations have not directly exercised.
- **package**: added a root `LICENSE` file — a short pointer to
  `LICENSE-MIT`/`LICENSE-APACHE` (the actual, unmodified license texts,
  present since the initial commit and unchanged by this release), not a
  new or different license grant. GitHub's own license detection reported
  `NOASSERTION`/"Other" for this repository without a root `LICENSE` file
  present; this corrects that without touching either full license text.
  Added to the npm `files` allowlist alongside the two it points to.

### Verified (see [RELEASE.md](RELEASE.md))

- `npm test`, `npm run typecheck`, `npm run lint` — all pass; also green on
  the CI matrix (Node 18/20/22 × ubuntu/windows/macos) for this exact commit.
- `npm run test:coverage` — 99.02% statements/lines, 95.6% branch, 98.81%
  functions (802/802 tests passing).
- `npm run test:mutate` — 87.70% mutation score (2165 killed + 39 timeout of
  2513 total mutants), above the 85% release bar.
- `npm run test:fuzz` run continuously for 10 minutes (105 full iterations,
  each reseeding fast-check's randomness): 0 failures.
- `npm run bench` — no anomalies against the existing throughput profile.

## [0.0.1-alpha.4] - 2026-08-20

### Added

- **guard**: `createAiSdkExecutionGuard()` — a drop-in, fail-closed execution
  guard for the Vercel AI SDK's `fullStream`. Composes `AiSdkStreamAdapter`
  with `createToolCallExecutionGate()` by reference, not reimplementation —
  no new parser, no new coordinator, no duplicated decision logic. Does not
  depend on the `ai` package at runtime and does not import its types
  (`push()` accepts `unknown`, same as every provider adapter). Internally
  built on a small, currently-unexported `createProviderExecutionGuard()`
  factory (`src/guard/provider-guard.ts`) so a second provider guard, if one
  is added in a future release, is close to free.
- **gate**: `DecisionEvidence` — every `ExecutionDecision` now carries an
  `evidence` object (`provider`, `providerReason`, `streamEndReason`,
  `terminalConfirmed`, `structurallyComplete`, `parserExecutable`,
  `schemaValid`, `receivedBytes`) explaining why it came out the way it did.
  Purely observational: nothing on `evidence` ever feeds back into
  `decideExecution()`'s own logic, and it can never change
  `action`/`executable`/`reason`. A received-chunk count was considered and
  deliberately left out — the parser only tracks cumulative bytes, not
  `push()` call counts, and adding that tracking solely to populate a metric
  here was judged not worth the new cross-layer coupling for this release.
  This is an additive field on the existing `ExecutionDecisionCommon`
  interface; no existing field changed shape.
- **providers**: `AiSdkStreamAdapter` now explicitly handles the `'abort'`
  fullStream part (present on `ai@5`/`6`/`7`'s `fullStream` union) by
  normalizing it to `provider_stream_end` / `"cancelled"`. Previously fell
  through to the adapter's `default` case silently, relying entirely on a
  caller's own `finish()` meta as the fail-closed backstop for a stream the
  adapter itself never learned had ended.
- **tests**: AI SDK v5/v6/v7 compatibility evidence
  (`test/guard/ai-sdk-compatibility.test.ts`) — the `fullStream` `id`-based
  tool-input-part shape and the `finishReason` literal vocabulary were
  verified identical across the published type declarations for
  `ai@5.0.240`, `ai@6.0.259`, and `ai@7.0.70` (downloaded and inspected
  directly, not recalled from memory) before writing the shared fixture set
  this file uses to justify a single cross-version test suite. Covers safe
  (`stop`, `tool-calls`) and unsafe (`length`, `content-filter`, `error`,
  `other`, `abort`, bare stream end with no terminal part at all) terminal
  states, crossed with generate-like complete input, multi-chunk streamed
  input, string truncation, container-level truncation, malformed JSON,
  schema-invalid-but-structurally-complete input, and concurrent tool calls.
- **tests**: cross-product execution-safety invariants and red-team
  scenarios (`test/invariants/execution-priority.test.ts`) — schema validity
  cannot override an unsafe terminal state, a safe terminal state cannot
  override parser incompleteness, a complete parser state cannot override an
  unsafe terminal state, an unrecognized future finish reason fails closed,
  the adapter never reads the SDK's own resolved/repaired tool-call input,
  and a `NonExecutableDecision`'s missing `value` field is enforced at the
  type level (a `@ts-expect-error` regression test that fails `pnpm run
  typecheck` if `value` is ever exposed there again).
- **examples**: `examples/ai-sdk-guard.mjs` (`pnpm run example:ai-sdk-guard`)
  — the high-level guard's own CI-run, no-network, no-API-key demonstration,
  alongside the existing low-level `examples/ai-sdk-execution-gate.mjs`.

### Fixed

- **parser**: `finish()`'s `executable` computation used a denylist of five
  known-bad `StreamEndReason` values (`"length"`, `"network_error"`,
  `"provider_error"`, `"cancelled"`, `"unknown"`) rather than an allowlist
  requiring `reason === "complete"`. `StreamEndReason` is a closed union at
  the type level, so a well-typed caller could never trigger the gap this
  left — but `finish()`'s `reason` argument is never validated at runtime,
  and a caller using `createParser()` directly (the package's foundational,
  documented API — not every integration goes through a bundled provider
  adapter) could pass a raw, unmapped provider string straight through. Any
  such string outside the five denylisted values fell through every check
  and reported `executable: true` for an otherwise well-formed document,
  even though the stream's completion was never actually confirmed. This is
  distinct from the AI SDK adapter's own `finishReason` normalization
  (already covered by `test/invariants/execution-priority.test.ts`'s
  "unknown future finish reason fails closed" case, which maps an
  unrecognized SDK literal to the safe `"unknown"` before it ever reaches
  the parser) — this fix closes the same class of gap one layer down, at
  the parser's own public `finish()` boundary, for any caller regardless of
  which adapter (if any) sits in front of it. `decideExecution()` in
  `gate/decide.ts` delegates its own `execute` branch directly to
  `call.parser.executable`, so this fix also closes the equivalent gap at
  the gate/guard layer without any change needed there.
- **gate**: `ExecuteDecision.name` narrowed from `string | undefined` to a
  required `string`. The coordinator only ever transitions a call to status
  `"complete"` when its name is known (a nameless call is forced to
  `"invalid"` instead), so every `ExecuteDecision` genuinely has one at
  runtime — the type didn't say so. This wasn't just a type-precision
  nitpick: README's and `docs/EXECUTION_GATE.md`'s own quick-start example,
  `tools[decision.name](decision.value)`, failed `tsc --noEmit` (TS2538)
  under this repo's strict config as a result, while `gate.ts`'s own JSDoc
  example papered over the same issue with a `decision.name!` non-null
  assertion (now removed). `decideExecution()` additionally requires
  `call.name !== undefined` before constructing an `ExecuteDecision` -
  defensive/redundant with the coordinator's own invariant, so a future
  violation of it still fails closed to `"stream_incomplete"` instead of
  fabricating a name.
- **providers**: `OpenAIStreamAdapter` now reads `response.incomplete_details.reason`
  on OpenAI Responses `response.incomplete` events instead of unconditionally
  mapping the whole event to a generic `"cancelled"` stream-end reason.
  `reason: "max_output_tokens"` now normalizes to `"length"` — a positively
  observed truncation, not a generic cancellation — verified against the
  `openai-node` SDK's `Response`/`ResponseIncompleteEvent` types, which
  confine `incomplete_details.reason` to exactly `"max_output_tokens"` and
  `"content_filter"`. `"content_filter"` now raises the same
  `E_CONTENT_FILTERED` diagnostic the AI SDK adapter already raises for its
  own `content-filter` finish reason, so the gate rejects with
  `"content_filtered"` instead of the generic `"stream_incomplete"` it
  would otherwise fall back to. Any other or missing reason now normalizes
  to `"unknown"` rather than `"cancelled"`, so a future OpenAI-added reason
  this adapter hasn't been taught yet reads as genuinely unclassified
  rather than being mislabeled as a user/API-initiated cancellation — both
  were already fail-closed for execution purposes (`isExecutable()` treats
  `"cancelled"` and `"unknown"` identically), so this is a diagnostic-
  precision fix, not a change to what does or doesn't execute.
- **providers**: `OpenAIStreamAdapter` now handles the `response.failed`
  event, which was previously unhandled entirely — the adapter would
  silently return zero events and never mark the stream finished. It now
  normalizes to `provider_stream_end` with `reason: "provider_error"`,
  matching the existing generic `error` event type's handling.

This is an observable behavior change for any caller inspecting the raw
`reason`/`providerReason` fields on `response.incomplete`: previously
always `"cancelled"`, now `"length"`, `"cancelled"` (content filter, with
an accompanying diagnostic), or `"unknown"` depending on the provider's
own `incomplete_details.reason`. It does not change any `execute` vs.
non-`execute` outcome from the execution gate.

## [0.0.1-alpha.3] - 2026-08-17

### Added

- **gate**: `createToolCallExecutionGate()` — a fail-closed, high-level
  execution-decision layer built by composition on top of
  `createToolCallStreamCoordinator()`. Maps each tool call's settled state
  to an `ExecutionDecision` (`action: "execute" | "retry" | "reject"`, plus
  a machine-readable `reason`) via a deterministic, priority-ordered
  decision table (`src/gate/decide.ts`) — every fail-closed disqualifier
  (resource limits, provider errors, content-policy terminations, schema
  mismatches, positively-observed truncation) is evaluated before the
  single `execute` branch, which is reached only once nothing above has
  ruled it out. `ExecutionDecision` is a discriminated union
  (`ExecuteDecision | NonExecutableDecision`): `value` exists (and is
  guaranteed non-`undefined`) only on the `execute` branch — TypeScript
  itself rejects code that reads `decision.value` without first narrowing
  on `decision.action === "execute"`. The status→decision switch has no
  `default` case, so `noImplicitReturns` fails the build if a future
  coordinator status isn't explicitly handled here, rather than silently
  falling through. No re-parsing: the gate reads already-computed
  coordinator/parser state, adding only the stream-end reason it tracks
  itself. See `docs/EXECUTION_GATE.md` for the full decision table,
  provider finish-reason mapping, fail-closed guarantees, and disclosed
  limitations.
- **providers**: `AiSdkStreamAdapter` (`ProviderName` gains `"ai-sdk"`) for
  the [Vercel AI SDK](https://ai-sdk.dev)'s `fullStream` tool-call shape
  (`tool-input-start` / `tool-input-delta` / `tool-input-end` / `finish`),
  verified against the published `ai@7.0.66` type declarations rather than
  guessed from an older API version. Follows the same pattern as the other
  five adapters — hand-rolled local interfaces for the wire shape, zero
  import of the `ai` package — so it adds no runtime dependency. Critically,
  it only ever feeds raw `tool-input-delta` text into this library's own
  parser and never reads the SDK's own resolved `tool-call.input`, which may
  already be silently repaired from a truncated stream by the SDK's
  internal `fixJson` (the exact class of problem this library exists to
  catch, documented in the README's Cline analysis, one layer further
  upstream). `finishReason: "content-filter"` is deliberately not mapped to
  a generic cancellation: it also emits a stream-wide `provider_diagnostic`
  with a new code, `E_CONTENT_FILTERED`
  (`src/coordinator/diagnostic-codes.ts`), which the gate matches on to
  report `reason: "content_filtered"` specifically — a policy/safety
  termination should not be retried the same way an incomplete stream
  would be. This required no changes to the core `StreamEndReason` type
  (still 6 values) or the parser's executable contract, by design — see
  decision-log.md #12.
- **coordinator**: `CoordinatorLimits` and `CoordinatorDiagnostic` are now
  exported from the package root (`src/index.ts`) — previously only
  referenceable structurally, never by name, despite
  `createToolCallStreamCoordinator()`'s first parameter already using the
  former.
- **examples**: `examples/ai-sdk-execution-gate.mjs` (`pnpm run
  example:ai-sdk`) — the same truncated-vs-complete `write_file` scenario as
  `examples/anthropic-truncation-safety.mjs`, through the AI SDK adapter and
  the new execution gate, against the real published `dist/` API. Wired
  into CI alongside the existing Anthropic example.
- **docs**: `docs/EXECUTION_GATE.md` — threat model, `execute`/`retry`/
  `reject` semantics and the full decision table, per-provider finish-reason
  mapping, schema interaction, a runnable example, fail-closed guarantees,
  and an honest limitations section (including a real, pre-existing
  `GrammarStack.canSafelyCloseAll()` reach limit found while writing this
  phase's tests — see below).

### Documentation

- **README**: repositioned around execution integrity rather than leading
  with parser internals. New opening states the library's purpose in one
  sentence ("Don't execute incomplete AI tool calls") with a before/after
  diagram, followed immediately by the execution-gate quick start. All
  existing technical content (the parser problem statement, the
  `vercel/ai`/`langchain` comparison, the Cline `jsonrepair` case study) is
  preserved verbatim, now framed as the lower-level foundation the gate is
  built on. New "Scope: what this does and doesn't protect against" section
  states plainly that this is not a prompt-injection defense, an
  authorization layer, a sandbox, or malicious-tool-choice detection.
- **decision-log.md**: four new entries (#9–#12) documenting why the gate is
  built by composition rather than a new state machine, why
  `ExecutionDecision` is a discriminated union rather than one type with an
  optional field, why fail-closed disqualifiers are evaluated before the
  positive `execute` branch (with an exhaustive, `default`-free switch as
  the enforcement mechanism), and why content-filter detection is a
  diagnostic code rather than a new `StreamEndReason` literal.
- **architecture.md**: added a short "Layers above the parser" section
  documenting the (already-existing but previously undocumented)
  coordinator, plus the new gate.

### Known limitation (disclosed, not fixed this phase)

- **grammar**: `GrammarStack.canSafelyCloseAll()` (used by
  `closeContainersAtFinish: "safe-only"`) only inspects each container
  frame's own expectation. An ancestor object whose value is itself an
  in-progress-but-closeable child container is treated as "still missing a
  value," which blocks the safe-close repair for the *entire* stack, not
  just that frame. A single unclosed container (e.g. `["a","b"`) salvages
  correctly; two nested unclosed containers (e.g. `{"commands":["a","b"` —
  the literal example from this phase's spec) currently reports
  `"truncated"` rather than `"salvaged"`. This does not weaken any safety
  guarantee — the execution gate refuses to execute either way, proven by a
  dedicated regression test — but it means the gate's more specific
  `stream_incomplete` reason doesn't fire for every case the JSON shape
  could in principle support. Found while writing this phase's tests (see
  `test/unit/execution-gate.test.ts`), not fixed here: a core
  `GrammarStack` change is out of scope for this API-layer phase. Tracked
  as a Phase 2 candidate.

## [0.0.1-alpha.2] - 2026-08-12

### Added

- **coordinator**: `createToolCallStreamCoordinator()` accepts an optional
  third argument, a map of tool name → JSON Schema (draft-07). When a call
  for a registered tool reaches a structurally complete outcome, its
  `stableValue` is validated against that schema via `ajv`. Structural
  prefix-safety and schema validity are independent concerns — a value can
  be genuinely complete and still not match what the tool declared it
  needs (a required field the model never provided at all, a wrong type).
  Both must hold for the coordinator's `executable` to be `true`. Exposed
  as `ToolCallState.schemaValid` (`true`/`false`/`undefined` — undefined
  when no schema was registered for that tool) and, on mismatch, a new
  `E_SCHEMA_VALIDATION_FAILED` coordinator diagnostic with ajv's own error
  detail. Schemas are compiled eagerly at construction time so a malformed
  schema fails fast rather than mid-stream. `ajv` moves from a devDependency
  (previously unused - the feature had never actually been built) to a
  real dependency.

### Removed

- **docs**: removed "Advanced repair engine (structural/lossy repairs)"
  from the README's roadmap. "Lossy repair" means fabricating or guessing
  a value to fill a gap — the opposite of this library's core principle,
  not a missing feature to build toward. Leftover from early planning that
  no longer fit once the actual design solidified.

## [0.0.1-alpha.1] - 2026-08-11

### Fixed

- **utf8**: encoded UTF-16 surrogate halves (`U+D800`-`U+DFFF`) were
  accepted as valid UTF-8 and decoded into the corresponding lone
  surrogate, instead of being rejected. RFC 3629 prohibits encoding
  surrogate halves directly in UTF-8 - they exist only as a UTF-16
  encoding artifact and are not valid Unicode scalar values. A 3-byte
  sequence can land arithmetically in this range (e.g. `ED A0 80` decodes
  to `U+D800`) without tripping the existing overlong or `>0x10FFFF`
  checks, so it needs its own explicit range check. Found via an
  independent third-party audit of the published package (constructed the
  adversarial byte sequence, confirmed Node's own strict `TextDecoder`
  correctly rejects it while this decoder did not); reproduced and fixed
  here, not taken on faith - see `test/unit/utf8.test.ts` and
  `test/unit/scanner-error-paths.test.ts` for the regression tests,
  including boundary checks just outside the surrogate range.

## [0.0.1-alpha.0] - 2026-08-10

Result of an extended, multi-round adversarial audit: differential testing
against `JSON.parse`, fuzz testing, exhaustive chunk-boundary testing,
mutation testing (Stryker), memory/leak testing, resource-limit boundary
testing, and manual review. 13 real defects were found and fixed, each with
a regression test proven to fail before the fix and pass after.

Separately, a coverage-improvement pass fixed a `vitest.config.ts` bug
(`coverage` was a sibling of `test`, not nested inside it, so the exclude
list was silently never applied), removed an accidentally-committed
206-file stale Stryker sandbox directory, deleted three more confirmed-dead
code paths (`Scanner.processObjectKey()`/`ScannerState.ObjectKey`,
`SnapshotBuilder.processEvent()`'s unreachable root-scalar branch,
`Utf8Decoder.reset()`/`totalBytesProcessed`), and added real regression
tests for previously-unexercised error paths in the scanner, decoder, and
coordinator. Statement coverage: 77.75% -> 93.10% (target 95%, see
RELEASE.md) — almost entirely from fixing the measurement itself and
removing dead code, not from padding tests.

A follow-up mutation-testing pass targeted the largest surviving-mutant
clusters (identified via scoped Stryker runs, one file at a time) across
all 7 mutated files: `diagnostics/factory.ts` 100%, `grammar/pointer.ts`
100%, `grammar/frame.ts` 95.83% (2 confirmed-equivalent survivors),
`grammar/stack.ts` 62.10% -> 99.19%, `utf8/decoder.ts` 63.32% -> 84.69%,
`lexer/scanner.ts` 73.48% -> 80.68%, `parser.ts` 59.10% -> 67.07% (by far
the largest file - 2258 mutants, more than the other 6 combined -
substantial gaps remain, not claimed resolved). Target is 85% (see
RELEASE.md); not yet reached overall, reported honestly rather than
rounded up. One real bug was found in the course of writing these tests
(not a mutant itself - surfaced while testing an edge case): see the
`utf8` entry below.

A second `parser.ts`-focused pass (still the largest gap by far) added
tests for a previously entirely-uncovered branch (`push()` after the
parser has already gone terminal was never tested at all — 60 mutants
with zero coverage on that one guard), the unexpected-token guards for
`[`, `{`, `:`, and a bare string inside an array, duplicate-key scalar
skip resumption (the existing tests only ever skipped a duplicate as the
*last* key, never followed by more real keys), the `reason==="complete"`
gate on finalizing a fully-typed-but-unterminated literal (`"true"` with
no trailing character is a different case from `"true"` followed by
something), exact UTF-8 byte-length boundary codepoints (U+007F/U+07FF/
U+FFFF, where `<=` and `<` disagree — prior tests only used interior
codepoints like é/漢, which can't distinguish the two), the structural
salvage guard's individual clauses, and exact diagnostic-field checks for
several stream-end conditions (unterminated \u escape, unpaired
surrogate, oversized input, mismatched `]`). `parser.ts`: 67.07% -> 81.73%
(survived mutants 291 -> 159). Also deleted one more confirmed-dead code
path found in the process: an `if` block in `push()` whose entire body
was comments with no executable code.

Several additional survivor clusters were investigated and left
deliberately unkilled as confirmed equivalent mutants, given real
invariants elsewhere in the code make them unobservable via any
black-box test: `isExecutable()`'s `this.terminal || this.syntax_ ===
"invalid"` (every one of the 24 sites that sets `syntax_ = "invalid"`
also sets `terminal = true` in the same statement pair, with no
exception), `everHadFatalDiagnostic`/`everHadStructuralOrLossyRepair`
(every real code path that could set either flag already independently
forces `isExecutable()` false first, via `terminal`/`syntax_` or the
`reason` check — `R_CLOSE_CONTAINER`'s only construction site is gated on
`reason !== "complete"`, which `isExecutable()` already rejects outright),
the `!diag.recoverable` clause in the non-recoverable-error check (no
diagnostic in the codebase is ever constructed with `severity` in
`{error, fatal}` *and* `recoverable: true` — the one `recoverable: true`
site uses `severity: "warning"`), and `determineOutcome()`'s
`reason !== "complete" && reason !== "unknown"` branch (both it and its
fallthrough return `"valid"`).

**Final combined mutation score (all 7 mutated files together, one
unscoped `pnpm test:mutate` run — the number that actually matters for
the 85% bar, not per-file scoped estimates): 78.17%** (up from 58.52% at
the start of this effort). Per file: `diagnostics/factory.ts` 100%,
`grammar/pointer.ts` 100%, `grammar/stack.ts` 98.39%, `grammar/frame.ts`
91.67%, `utf8/decoder.ts` 82.65%, `lexer/scanner.ts` 78.56%, `parser.ts`
73.35%. Note the combined-run `parser.ts` number (73.35%) is lower than
the isolated scoped-run number quoted above (81.73%) for the identical
code and tests — Stryker clusters "static" mutants differently when one
file is mutated in isolation versus when all 7 are mutated together in
the same run, and the combined run carries more timeout-classified
mutants under the heavier concurrent load. The scoped number isn't wrong,
but the combined number is the one that reflects reality when the whole
suite runs together, so it's the one reported as authoritative here.

78.17% is still below the 85% target in RELEASE.md. Work on closing that
gap stopped at this point: the largest remaining survivor clusters were
individually investigated (see above) and are either genuinely
unkillable equivalent mutants, or small (1-2 mutant) scattered survivors
whose cost per additional point had grown high relative to the rest of
this effort. The gap is disclosed here rather than closed by continuing
to chase it — the library's `alpha`/"do not use in production" status in
the README remains accurate and unchanged for exactly this reason.

As a side effect of the tests added for the mutation-testing pass above
(which exercised branches coverage had missed regardless of any mutant),
statement coverage rose further: 93.10% -> **96.30%**, now past the 95%
target in RELEASE.md. Of the two quantitative release gates, coverage is
now met; mutation score (78.17%) is not.

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
- **utf8**: resuming a multi-byte sequence left pending from a previous
  chunk, when the resumption byte turned out not to be a valid
  continuation byte, emitted a correct `invalid_continuation` diagnostic
  but then spuriously emitted a *second*, bogus diagnostic alongside it —
  the abort path reset both `pending` and `pendingExpected` to 0, which
  the very next check read as "0 of 0 bytes needed, sequence complete,"
  triggering a decode of the now-empty pending array. No wrong decoded
  *text* was ever produced (the spurious call always hit its own error
  branch), so this was strictly an extra incorrect diagnostic, not silent
  data corruption. Found while writing a mutation-testing regression test,
  not by a mutant itself.

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
- **lexer**: deleted `Scanner.processObjectKey()` and the
  `ScannerState.ObjectKey` enum member — confirmed nothing in `src/`
  ever assigns that state, so the dispatch case and method were dead.
- **semantic**: deleted the unreachable `path === ""` branch in
  `SnapshotBuilder.processEvent()` — the one event that could carry an
  empty path (a root-level scalar) is handled entirely through
  `Parser.rootScalarValue` and never reaches `processEvent()` at all.
- **utf8**: deleted `Utf8Decoder.reset()` and the `totalBytesProcessed`
  getter — unused anywhere in `src/` or `test/`, and `Utf8Decoder` isn't
  part of the public API.
- **parser**: deleted an `if` block in `push()` (trailing-data detection)
  whose entire body was comments explaining why no code was needed there
  — found while investigating why its condition survived mutation testing
  with zero possible observable effect.
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
