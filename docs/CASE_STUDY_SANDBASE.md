# Case study: Sandbase Harness

Sandbase Harness provides a publicly verifiable dependency and runtime
integration of `prefix-safe-json` outside this repository. This is not a
customer relationship, endorsement, or confirmation of production deployment.
An independent maintainer reported passing project integration tests for the
historical `0.4.3` upgrade. The later `0.5.0` snapshot has not received that
same confirmed project-level validation.

The source snapshot below is pinned to Sandbase commit
[`427b52a96a5309ca23268407f85c237468ab6a4e`](https://github.com/sandbaseai/sandbase-harness/tree/427b52a96a5309ca23268407f85c237468ab6a4e),
checked on 2026-10-13. It does not describe future changes to `main`.

## What Sandbase needed to close

Sandbase's harness confirms tool calls with the model before executing
them: a call is proposed, a decision is recorded, and only a confirmed
decision is allowed to reach the real side effect. That confirmation step
is exactly the boundary where a raw-vs-projected value distinction
matters — a proposal that *looks* final because some SDK-level projection
of it appeared complete is not the same fact as "the provider actually
confirmed this call is done, with no later evidence contradicting it."
The committed integration places a raw-stream guard at that
confirmation-persistence boundary. Source inspection establishes that wiring;
it does not establish how often the path runs in a deployed system.

## How it was integrated

At the pinned commit, Sandbase's
[`package.json`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/package.json#L123-L137)
directly depends on:

```json
"prefix-safe-json": "0.5.0",
"ai": "^7.0.128"
```

The dependency is referenced by runtime source, not just a lockfile entry.
[`default-strategy.ts`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts#L355-L368)
uses `createAiSdkExecutionLock()`. Its
[`ai-sdk-v4-execution-guard.ts`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/ai-sdk-v4-execution-guard.ts)
wraps `createAiSdkExecutionGuard()`: it translates older stream-part names,
passes modern parts through, and does not rebuild raw arguments from the
SDK's parsed `tool-call` projection. The bridge's v4 name does not establish
an incompatibility with the declared `ai ^7.0.128` dependency. That version
range alone is not an exact installed-version result or part of this repository's
exact `ai@7.0.77` lifecycle proof. The pinned
[`package-lock.json`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/package-lock.json)
records `ai@7.0.128` and `prefix-safe-json@0.5.0`. PSJ's isolated npm-consumer
CI checks its candidate tarball with exact `ai@7.0.128` across five mock-provider
scenarios, documented in [COMPATIBILITY.md](COMPATIBILITY.md). That consumer
check does not run Sandbase's application or prove its installed/deployed state.

The
[confirmation path](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts#L740-L836)
drains `fullStream`, feeds the guard, calls `guard.finish()`, and takes
per-call authority through `takeDecision()`. This is source-level evidence;
the complete Sandbase application was not rerun for this snapshot.

## The security upgrade

A later `prefix-safe-json` release (`0.4.2` → `0.4.3`) patched
[GHSA-3xpw-9694-2xxp](https://github.com/canblmz1/prefix-safe-json/security/advisories/GHSA-3xpw-9694-2xxp),
fixing three root causes in the exact AI SDK adapter/gate surface
Sandbase's integration depends on:

1. `AiSdkStreamAdapter.push()` used to silently drop every raw event once
   it had already observed its own terminal, so late/contradictory
   evidence for a call never reached the coordinator at all.
2. `takeDecision()` used to read a decision snapshot frozen at
   `finish()` time instead of the coordinator's live diagnostics, so
   evidence recorded after `finish()` but before that call's authority
   was consumed was never consulted.
3. A raw event carrying conflicting `id`/`toolCallId` used to silently
   prefer `id` instead of failing the stream closed.

Sandbase merged the upgrade
([sandbaseai/sandbase-harness#117](https://github.com/sandbaseai/sandbase-harness/pull/117))
and the pinned source snapshot now declares `0.5.0`.

On 2026-08-30, maintainer `liyangbing`
[reported verification on the upgrade PR head](https://github.com/sandbaseai/sandbase-harness/pull/117#issuecomment-5471098695),
including 11 passing tests across `post-terminal-authority.test.ts` and
`tool-confirmation-reliability.test.ts`, a build, a package check, and a release
smoke check. The reviewed head
[`24cf9a04bbad0bf14ffc3972d7409ade1c4a11eb`](https://github.com/sandbaseai/sandbase-harness/tree/24cf9a04bbad0bf14ffc3972d7409ade1c4a11eb)
pins `prefix-safe-json@0.4.3`. Its
[confirmation tests](https://github.com/sandbaseai/sandbase-harness/blob/24cf9a04bbad0bf14ffc3972d7409ade1c4a11eb/tests/integration/tool-confirmation-reliability.test.ts)
exercise the application's own session executor, confirmation path, and
sandbox write counter: a complete call writes once after confirmation, and a
length-limited stream writes zero times. Its
[post-terminal tests](https://github.com/sandbaseai/sandbase-harness/blob/24cf9a04bbad0bf14ffc3972d7409ade1c4a11eb/tests/integration/post-terminal-authority.test.ts)
also import PSJ directly and through Sandbase's runtime wrapper.

This is a maintainer-reported run of project integration tests with a scripted
model, not a live-provider trace or production rollout. It establishes
historical independent use of the `0.4.3` integration; it does not validate
the later `0.5.0`/AI SDK 7 snapshot or every consumer's patch compatibility.

## What this proves

- A separate public repository declares `prefix-safe-json@0.5.0` as a direct
  dependency and references its lock/guard surface in runtime code.
- The pinned source wires raw-stream evidence into confirmation decisions.
- A public upgrade PR and the later dependency pin are observable history.
- An independent maintainer reported passing application-boundary tests on
  the historical `0.4.3` upgrade head.

## What this does not prove

- Production deployment, adoption at scale, or an independent maintainer-run
  result for the later `0.5.0` snapshot. These have not been confirmed.
- That Sandbase endorses this project beyond the committed integration.
- End-to-end compatibility of the whole Sandbase application, or that every
  integration pattern documented here has been independently exercised.

This evidence classification matches the Sandbase row in
[`REAL_WORLD_FAILURES.md`](REAL_WORLD_FAILURES.md).
