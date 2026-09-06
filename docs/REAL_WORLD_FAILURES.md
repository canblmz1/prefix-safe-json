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
| [cline/cline](https://github.com/cline/cline) | `experimental_repairToolCall` repairs a truncated argument string (closes an unterminated string as-is) and the repaired value *is* the tool call that runs | Real: a `write_file` call with a `content` argument cut off mid-value writes the truncated content to disk, no error or warning | INTERNAL REPRODUCTION ONLY — reproduced directly against `sdk/packages/shared/src/parse/json.ts` (commit `81cce3d70e1`), not reported upstream | Concrete before/after in the README's "A concrete case where this matters" section; the gap is narrow (distinguishing "syntax is wrong" from "cut off mid-value, rest unknown") and specific to that one repair path, not all of `jsonrepair`'s behavior |
| [TanStack/ai](https://github.com/TanStack/ai) | `server_tool_use` (web fetch/search) streaming corrupted a prior, already-buffered `tool_use` block's input | Real: confirmed and fixed by the maintainers | UPSTREAM FIX MERGED — [TanStack/ai#604](https://github.com/TanStack/ai/issues/604), merged via [TanStack/ai#606](https://github.com/TanStack/ai/pull/606) (2026-05-21) | Confirms the maintainers treat this failure class as a real, mergeable bug once found; a *separate*, still-open gap in the same codebase (an OpenAI Responses `.delta`-after-`.done` race, ungated unlike the already-fixed race) was investigated but not reported — see the note below |
| [continuedev/continue](https://github.com/continuedev/continue) | Interleaved parallel OpenAI tool-call argument fragments applied to the wrong call when a continuation fragment carries `index` but no `id` (the SDK's own documented shape: `index` required, `id` optional) | Real: reproduced end-to-end against the actual `applyToolCallDelta`/`addToolCallDeltaToState` path — a complete argument swap between two concurrently streaming calls | OPEN REPORT — [continuedev/continue#13223](https://github.com/continuedev/continue/issues/13223), fix proposed in [continuedev/continue#13224](https://github.com/continuedev/continue/pull/13224) (open, unmerged). **Separately, project maintenance status as of this writing**: `main`'s tip commit is dated 2026-07-21 with zero commits merged to it since (independently verified via the GitHub API, not assumed), against ~30 open PRs including this one; PR/issue *traffic* is active (comments, bot checks, new PRs opened daily) but nothing has actually landed on `main` in 6+ weeks. Read the "open report" status as exactly that - not as an active-adoption prospect in the near term. | The exact identity-correlation invariant `NormalizedToolStreamEvent`'s `callRef.sourceKey` model and this package's provider adapters exist to hold |
| [earendil-works/pi](https://github.com/earendil-works/pi) | A streamed function call's argument evidence can disagree across `function_call_arguments.delta` (accumulated), `function_call_arguments.done`, and `output_item.done`; the last representation silently wins with no consistency check | Real: reproduced against the real, current OpenAI Responses stream parser — a normal (non-truncated) `toolUse` completion reaches real tool execution with corrupted arguments | CLOSED / NOT ADOPTED — [earendil-works/pi#8959](https://github.com/earendil-works/pi/issues/8959). Precise timeline, verified via the GitHub API's own issue-events log, not assumed: auto-closed by `github-actions[bot]` one second after filing (2026-09-01T11:59:35Z, the project's documented new-contributor policy - see `CONTRIBUTING.md`); a real maintainer, `badlogic`, then manually applied the `last-read` label 48 minutes later (12:47:26Z) - direct evidence the issue *was* opened and reviewed by a human, not left untouched; `github-actions[bot]` applied `no-action` six minutes after that (12:53:02Z), which reads as the bot's own automated translation of the maintainer's `last-read` signal into a terminal triage state, not a second independent bot action. There is still no human-authored text comment on the issue, and no further follow-up was made. This is a materially different, more precise picture than "purely automated, no human involvement" - a human did look at it and chose not to write anything or escalate it, which is itself a real (if minimal) signal, not the absence of one. | Directly generalizes to `docs/CONFORMANCE.md`'s C10 note: this exact ambiguity is structurally impossible to represent at PSJ's own normalized-event layer, because it is resolved one layer below, inside the provider adapter, before a normalized event exists |
| [sandbaseai/sandbase-harness](https://github.com/sandbaseai/sandbase-harness) | A raw/projection boundary in tool-call confirmation persistence | See `docs/CASE_STUDY_SANDBASE.md` | EXTERNAL PSJ ADOPTION — `prefix-safe-json@0.4.3` is a current, direct `dependencies` entry on `main` | The one independently maintained external production adopter this project is currently aware of |

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
time) and is recorded here as **INTERNAL REPRODUCTION ONLY** for the same
reason as the Cline case: verified against real source, not yet a public
report.
