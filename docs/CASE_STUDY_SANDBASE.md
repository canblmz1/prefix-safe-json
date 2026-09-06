# Case study: Sandbase Harness

Sandbase Harness is the first independently maintained external runtime
currently known to use `prefix-safe-json` as a production dependency.

This is not a customer relationship and not an endorsement beyond what is
directly observable in Sandbase's own public repository. Everything below
is drawn from Sandbase's own committed code and commit history, verified
directly against `sandbaseai/sandbase-harness`'s current `main` branch.

## What Sandbase needed to close

Sandbase's harness confirms tool calls with the model before executing
them: a call is proposed, a decision is recorded, and only a confirmed
decision is allowed to reach the real side effect. That confirmation step
is exactly the boundary where a raw-vs-projected value distinction
matters — a proposal that *looks* final because some SDK-level projection
of it appeared complete is not the same fact as "the provider actually
confirmed this call is done, with no later evidence contradicting it."
Before adopting `prefix-safe-json`, Sandbase's own confirmation-persistence
path had no independent way to distinguish those two facts from each
other.

## How it was integrated

The integration originated from an external investigation into Sandbase's
own AI SDK usage, was incorporated into Sandbase's `main` branch, and
Sandbase depends on `prefix-safe-json` directly — `package.json`, current
`main`:

```json
"prefix-safe-json": "0.4.3"
```

Sandbase's own `default-strategy.ts` drains the full AI SDK `fullStream`,
calls `guard.finish()` once, and resolves each pending confirmation call's
`takeDecision()` synchronously in the same tick — the same pattern this
project's own README recommends, adopted independently.

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
with no public API change on their side — `createAiSdkExecutionGuard()`/
`createAiSdkExecutionLock()` and the `push`/`finish`/`takeDecision`/
`snapshot` surface Sandbase's integration reads were confirmed unchanged
directly against the installed package's own `.d.ts` files before the
upgrade landed, not assumed.

## What this proves

- A real, independently maintained runtime found this package's
  guarantee valuable enough to adopt in production, not just evaluate.
- The integration survived a real security patch with zero call-site
  changes on the adopter's side — evidence the public API surface this
  project commits to (`docs/COMPATIBILITY.md`) is genuinely stable enough
  to depend on across a patch release.
- The upgrade was itself driven by a genuine security disclosure being
  taken seriously and acted on quickly by both sides.

## What this does not prove

- Broad market validation. This is one adopter, publicly verifiable, not
  a survey or a claim about adoption at scale.
- That Sandbase endorses this project beyond the fact of depending on it.
- That every integration pattern this project documents has been
  independently exercised in production — only the specific
  `fullStream` → guard → `finish()` → `takeDecision()` pattern Sandbase
  actually uses.
