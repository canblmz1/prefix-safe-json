# Real-world failures in this problem class

This is not a claim that any of the projects below have a `prefix-safe-json`
integration, and it is not a vulnerability disclosure document. It exists
to show that "streamed tool-call arguments reaching execution before
lifecycle evidence confirms they're safe" is a real, recurring class of
defect independently found across multiple, unrelated agent runtimes —
larger than this one package.

Every row below was either independently investigated and empirically
reproduced (with a real, unmocked reproducer against the project's actual
source), or is drawn from this repository's own documented evidence. No
row is inflated past its verified classification.

## Classification key

- **UPSTREAM FIX MERGED** — a fix for this exact class landed and merged.
- **UPSTREAM BUG ACKNOWLEDGED** — a maintainer confirmed the report; no
  merged fix yet at time of writing.
- **OPEN REPORT** — reported upstream (issue and/or PR), not yet merged
  or acknowledged.
- **CLOSED / NOT ADOPTED** — reported upstream and closed without the
  underlying technical claim being addressed (e.g. automated triage
  closure, not a technical rejection — see the row's own note).
- **EXTERNAL PSJ ADOPTION** — a runtime outside this repository has
  `prefix-safe-json` as a real dependency in its own main branch.
- **INTERNAL REPRODUCTION ONLY** — investigated and reproduced against
  real source, not reported upstream (out of scope for that
  investigation, or no productive contribution path existed at the time).

| Project | Failure class | Real execution impact | Status | PSJ relevance |
| --- | --- | --- | --- | --- |
| [vercel/ai](https://github.com/vercel/ai) | Tool calls executing regardless of an unsafe finish reason | Real: reported and reproduced across AI SDK v5, v6, and v7 | UPSTREAM FIX MERGED — [vercel/ai#19063](https://github.com/vercel/ai/issues/19063), fixes landed across all three release lines | Direct motivation for `createAiSdkExecutionGuard()`'s "prove the finish reason, not just JSON shape" guarantee; PSJ does not patch or depend on that fix — see the README's "Why the model's finish reason matters" section |
| [cline/cline](https://github.com/cline/cline) | Truncated tool-call arguments repaired into plausible JSON; mid-string truncation and incomplete containers are separate cases | Constructed reproduction reported in [#13001](https://github.com/cline/cline/issues/13001). The maintainer [confirmed container-level truncation could still be repaired](https://github.com/cline/cline/issues/13001#issuecomment-5242529284); production frequency was not measured | REPORTED / PARTIAL UPSTREAM FIX MERGED — [#13015](https://github.com/cline/cline/pull/13015) merged on 2026-08-12 and addresses unterminated strings. #13001 is closed, but container completeness remained outside that fix. PSJ integration [#13304](https://github.com/cline/cline/pull/13304) was closed unmerged | Repaired JSON alone does not establish complete tool-call input. Cline did not adopt PSJ; the maintainer [declined the proposed dependency](https://github.com/cline/cline/pull/13304#issuecomment-5319181501) because it was too new to assess confidently. Status checked 2026-10-12; current end-to-end dispatch was not rerun |
| [TanStack/ai](https://github.com/TanStack/ai) | `server_tool_use` (web fetch/search) streaming corrupted a prior, already-buffered `tool_use` block's input | Real: confirmed and fixed by the maintainers | UPSTREAM FIX MERGED — [TanStack/ai#604](https://github.com/TanStack/ai/issues/604), merged via [TanStack/ai#606](https://github.com/TanStack/ai/pull/606) (2026-05-21) | Confirms the maintainers treat this failure class as a real, mergeable bug once found; a *separate*, still-open gap in the same codebase (an OpenAI Responses `.delta`-after-`.done` race, ungated unlike the already-fixed race) was investigated but not reported — see the note below |
| [continuedev/continue](https://github.com/continuedev/continue) | Interleaved parallel OpenAI tool-call argument fragments applied to the wrong call when a continuation fragment carries `index` but no `id` (the SDK's own documented shape: `index` required, `id` optional) | Real: reproduced end-to-end against the actual `applyToolCallDelta`/`addToolCallDeltaToState` path — a complete argument swap between two concurrently streaming calls | OPEN REPORT — [continuedev/continue#13223](https://github.com/continuedev/continue/issues/13223) remains open. Proposed fix [#13224](https://github.com/continuedev/continue/pull/13224) was [closed by its author](https://github.com/continuedev/continue/pull/13224#issuecomment-5791995165) on 2026-09-23 without merging. Status checked 2026-10-12; at that check, `main` pointed to [5522c6f](https://github.com/continuedev/continue/commit/5522c6f44ca0ac3528b37244818fbfa39b5af470), dated 2026-07-21T04:00:09Z. This branch snapshot does not establish future maintenance or adoption prospects. | The exact identity-correlation invariant `NormalizedToolStreamEvent`'s `callRef.sourceKey` model and this package's provider adapters exist to hold |
| [earendil-works/pi](https://github.com/earendil-works/pi) | A streamed function call's argument evidence can disagree across `function_call_arguments.delta` (accumulated), `function_call_arguments.done`, and `output_item.done`; the last representation silently wins with no consistency check | Real: reproduced against the real, current OpenAI Responses stream parser — a normal (non-truncated) `toolUse` completion reaches real tool execution with corrupted arguments | CLOSED / NOT ADOPTED — [earendil-works/pi#8959](https://github.com/earendil-works/pi/issues/8959). The [issue events](https://api.github.com/repos/earendil-works/pi/issues/8959/events) record filing at 2026-09-01T11:59:24Z and automated closure at 11:59:36Z, 12 seconds later. Maintainer `badlogic` applied `last-read` at 12:47:26Z; the bot applied `no-action` at 12:53:02Z. These are observed labeling actions, not proof of substantive review or technical agreement. At the 2026-10-12 check, the issue remained closed with no human-authored text reply; no further follow-up was made. | Directly generalizes to `docs/CONFORMANCE.md`'s C10 note: this exact ambiguity is structurally impossible to represent at PSJ's own normalized-event layer, because it is resolved one layer below, inside the provider adapter, before a normalized event exists |
| [sandbaseai/sandbase-harness](https://github.com/sandbaseai/sandbase-harness) | A raw/projection boundary in tool-call confirmation persistence | See `docs/CASE_STUDY_SANDBASE.md` | EXTERNAL PSJ ADOPTION — checked 2026-10-12 at `main` commit `427b52a`: [`package.json`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/package.json#L123-L137) directly depends on `prefix-safe-json@0.5.0`; runtime code uses the [execution lock](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts#L355-L368) and [feeds the guard before taking decisions](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts#L740-L836) | Verified public dependency and runtime integration. Production deployment and independent maintainer-run validation have not been confirmed. |

## A note on TanStack/ai's still-open gap

The merged fix above (`#606`) addressed a specific corruption pattern in
the Anthropic adapter. A separate, still-open concern was found during the
same investigation and independently reproduced: the OpenAI Responses
path's `response.function_call_arguments.delta` handler has no equivalent
guard against a late delta arriving after `.done` for the same item,
unlike the now-guarded Anthropic race. The empirically observed impact was
narrower than the Anthropic case — a late delta produces a spurious event
and the affected call silently never executes (no error surfaced), not a
corrupted execution — but it is still a real integrity gap in the same
lifecycle-evidence sense this package exists to close. It was not filed
upstream (out of scope for that investigation's authorization at the
time) and is recorded here as **INTERNAL REPRODUCTION ONLY**: verified
against real source, not yet a public report.
