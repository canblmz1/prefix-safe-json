# Adoption diagnosis — 2026-10-17

The October 17 observations below are historical. The
[October 22 continue/archive decision](#october-22-2026-continue-or-archive)
uses current releases, fair native comparisons and dated response evidence.

The strongest evidence is that several maintainers value the bug report but
prefer a small native correction to a new runtime dependency. This does not
establish why every other contacted developer has not tried PSJ. Most have
not answered, and the latest three invitations are only a few hours old.

The project has historical Sandbase dependency and runtime-integration
evidence. The separate campaign goal still has **0/5 newly confirmed
developers running PSJ in their own projects**. A native fix, fixture run,
download or invitation is not a new PSJ user.

## What developers actually said or did

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| [Cline maintainer response](https://github.com/cline/cline/pull/13304#issuecomment-5319181501), 2026-08-17 | The proposed dependency was declined because the package was very new and credibility was difficult to verify. | The same maintainer's current opinion of 0.6.x. This was an alpha-era decision. |
| [Sidecar maintainer response](https://github.com/nedonatelli/sidecar/issues/164#issuecomment-6179590817), 2026-10-14 | The maintainer confirmed the problem, chose an in-tree fix, and explicitly declined both the dependency and demo. Native Ollama semantics also differ from the Anthropic example. | A request for more invitations, or evidence that a larger PSJ API would change that decision. |
| [multi-llm-ts maintainer response](https://github.com/nbonamy/multi-llm-ts/issues/29#issuecomment-6226621249), 2026-10-16 | The report led to a native identity-correlation correction and a 5.1.2 release. | A general objection to PSJ, or adoption of PSJ. |
| [ai-sdk-ollama maintainer response](https://github.com/jagreehal/ai-sdk-ollama/issues/1092#issuecomment-6235264006) and [merged correction](https://github.com/jagreehal/ai-sdk-ollama/pull/1093), 2026-10-17 | The maintainer reproduced the issue and accepted a small native fix. | A PSJ integration request or verified npm publication of that correction. |

The last two are observed choices, not interviews about package selection.
Sidecar's decline should be respected; do not send another trial invitation.

## The outreach denominator is smaller than it looks

The owner-authenticated read-only snapshot at 2026-10-17 17:07 UTC contains:

- 23 watched threads across 21 repositories: 18 project-trial threads,
  two community presentations, one curated-list submission, one native
  validation request and one existing-adopter upgrade.
- Human replies in three watched repositories: Sidecar, multi-llm-ts and
  ai-sdk-ollama. Cline's older response is outside this campaign.
- Eight threads less than 24 hours old; three project-trial invitations
  less than six hours old. All watched invitations are approximately
  3.8–78.7 hours old at that snapshot.
- Zero submitted integration reports. This measures reported evidence,
  not every private or unreported installation.

The 18 project-trial threads are not 18 new qualified buyers: they include
an existing adopter, framework maintainers, and comparison/conformance
offers. The separately screened 1,000 repositories are a prospect list,
not 1,000 delivered offers or people who evaluated the package.

GitHub's traffic endpoint returned **20 views and six unique visitors** in
its reported 2026-10-03–2026-10-16 daily window. It also returned 2,424
clones and 305 unique cloners. These are different units; operator checks,
CI and automation are not isolated. Gist views, npm installs and private
evaluation are not measured by repository page views. There is no defensible
installation-to-active-use conversion rate or retention metric yet.

## The competing implementation is often already available

| Application need | Cheapest relevant alternative | When PSJ may add value |
| --- | --- | --- |
| One known finish-reason mapping defect in a provider | Correct the mapper and add a regression test | Only if the application also needs original-evidence and identity checks beyond that fix |
| One SDK already refuses token-limited execution | Keep and regression-test that native boundary | Additional call-identity or conflicting-evidence policy, demonstrated in the actual application |
| Progressive partial JSON or recoverable diagram output | Keep a preview/recovery parser and application policy | A separate pre-execution boundary when strict refusal is appropriate |
| Application owns dispatch across several providers | Maintain equivalent completion, identity and validation checks in the application | A reusable policy instead of maintaining that logic repeatedly |

The [external fit audit](EXTERNAL_FIT_AUDIT.md) records native controls,
integration mismatches and limits. Demonstrating an SDK defect is not enough
to demonstrate that a dependency is the best correction.

## Current integration cost

1. **Execution ownership must change.** A user with SDK `execute` callbacks
   must stop those callbacks, retain original events, drain each stream,
   consume decisions, dispatch effects and return matched tool results.
   The application still owns cancellation, retries, persistence and
   continuation. This is substantially more work than adding a parser.
2. **Some advertised ecosystems expose the wrong boundary.** Parsed
   LangChain messages alone are insufficient; the comparison requires
   original provider evidence. Native Ollama's tested path does not emit
   the required raw argument sequence. Gemini's structured projections
   do not provide the same strict raw-text authority. A six-SDK trial
   list is not a universal drop-in integration guarantee.
3. **First-use discovery lagged behind 0.6.0.** The default launcher still
   selected the older 0.5.4 single-step trial even though the typed
   tool → result → model example existed. The main README repeated long
   trial explanations and promoted an unrelated prototype.
4. **Trust and deployment costs remain.** The core is pre-1.0 and several
   integration surfaces are Experimental. AJV is still a required
   dependency even for users providing their own validator. A prior
   synthetic browser trial measured about 52,970 additional gzip bytes
   versus its validator-only control; that is not a measurement of an
   entire extension or a stated reason from a rejecting maintainer.

Items 1–4 are observable engineering costs. Except where a maintainer
explicitly connects them to a decision above, they are hypotheses about
conversion, not proven explanations for silence.

The earlier missing argument types and missing complete-loop example were
addressed in 0.6.0. They should no longer be reported as absent features.
The new example's effect on independent adoption has not been measured.

## Changes made before the next publication

- The current checkout's launcher now defaults to the published 0.6.0 typed
  loop. It creates an isolated consumer, checks strict TypeScript, returns
  a final answer in the complete case, and exercises four refusal/error cases.
- The README leads with that complete example and a short boundary-fit
  table. SDK-specific details live in the trial index; unrelated prototype
  promotion was removed from the package's first-use page.
- The integration guide states the execution migration and continuation
  requirements before a user tries to adapt a single-step example.
- The old six-SDK fixtures retain their original 0.5.4 pins. The current
  identity recipe selects `ai-sdk` explicitly; historical ZIP downloads
  are not described as if their launcher changed.
- The new Ollama reply is recorded as native validation, without increasing
  the independent-user count.

These changes reduce observable first-use friction. They do not prove new
demand, fix every framework boundary or establish five users. No package
publication is part of this diagnosis.

## What would justify the next adoption effort

Prioritize an application whose developer can retain raw events, control
dispatch, and name an unmet completion/identity requirement. Before making
another offer, compare its current native behavior with PSJ and provide a
small application-specific integration diff that preserves normal results
and continuation. A source match alone is insufficient qualification.

For willing developers, the useful next observation is their own development
branch running one complete harmless call and one relevant refusal case.
Record the first blocker verbatim enough to distinguish installation,
missing stream evidence, dispatch ownership, validator semantics and lack
of additional value. Do not require production deployment to acknowledge
a genuine own-project development run. Count a distinct developer only
after reviewing that evidence; repeated use remains a separate question.

There are no new interviews in this audit. Unanswered invitations remain
unknown, and more feature work should be driven by those concrete blockers
instead of treating every silent recipient as a product rejection.

The nearest existing application trials are
[Codemini CLI #53](https://github.com/havingautism/Codemini-CLI/issues/53),
[Jarvis #1097](https://github.com/vierisid/jarvis/issues/1097) and
[Director Desk #8](https://github.com/mangfufu/director-desk/issues/8).
Their prepared reproductions were run by the PSJ maintainer; independent
own-project runs remain unconfirmed. At this check their invitations are
less than six hours old. They are active opportunities, not proven refusals.
The next useful evidence is a willing maintainer's application run or a
specific integration blocker, rather than another unsolicited reminder.

## Validation of the first-use changes

The default command was run in a fresh temporary npm consumer with published
PSJ 0.6.0. Strict TypeScript compilation and all five loop scenarios passed.
The explicit `ai-sdk` command was also run in a fresh consumer with published
PSJ 0.5.4: five single-step scenarios, two interleaved batch scenarios and two
native/PSJ identity comparisons passed. These operator runs validate the
launcher and examples, not adoption.

The three existing README execution tests, lint, JavaScript syntax check,
invalid-argument checks, local Markdown link targets and `git diff --check`
passed. The eight existing adoption-watcher contract tests had also passed
with the reviewed Ollama response configuration.

## October 22, 2026: continue or archive

**Decision: retain the stable core, stop speculative feature expansion, and
allow one 30-day demand-validation cycle through November 21. Do not archive
now.** This is a bounded engineering decision, not evidence of product-market
fit or a forecast of 200,000 monthly downloads. No repository archive setting,
package deprecation, merge, release or external message was changed by this
review. Technical and adoption evidence were reviewed separately; these are
operator reviews, not new independent application evaluations.

Reviewed remote main remains `deab898cf4eb96fa7600ef37926e3ceaddcadb77`.
Registry releases are core **0.6.3** and companion **0.3.2**. The existing
local `published-release-result.json` audit already verified integrity,
signed provenance, clean consumer imports and source/package equivalence for
[the published release](https://github.com/canblmz1/prefix-safe-json/actions/runs/39645764793).
That receipt is a local audit artifact, not a file included in the published
package. Full tests, mutation and fuzz were
not rerun for this decision. Open evidence PRs
[90](https://github.com/canblmz1/prefix-safe-json/pull/90) and
[93](https://github.com/canblmz1/prefix-safe-json/pull/93) retain their reviewed
heads `9dc7dbc30b2e21f8a37842dfea2ba35c0682d351` and
`17007789e46c307c2dba8ed9a005c707f3333464`.

### Evidence for and against continued investment

| Observation as of October 22 | Implication |
| --- | --- |
| [npm API](https://api.npmjs.org/downloads/point/2026-09-22:2026-10-21/prefix-safe-json): **3,153** core downloads, September 22–October 21 inclusive; the 30 daily rows sum to the same number | 200,000 requires approximately **63.4 times** the recorded current volume; no channel delivering that growth is established |
| [Previous non-overlapping 30 days](https://api.npmjs.org/downloads/point/2026-08-23:2026-09-21/prefix-safe-json): **5,227** | The recorded total is about 39.7% lower. This is not a measured decline in active users: installs can include CI/operator work, and reporting freshness is not independently established |
| Companion [downloads API](https://api.npmjs.org/downloads/point/2026-09-22:2026-10-21/psj-ai-sdk) returns 404, while [registry metadata](https://registry.npmjs.org/psj-ai-sdk/latest) confirms 0.3.2 | Companion download count remains unknown, not zero |
| Sandbase's independent [original integration PR 80](https://github.com/sandbaseai/sandbase-harness/pull/80), accepted August 30, and [independent CI on October 12](https://github.com/sandbaseai/sandbase-harness/actions/runs/38202171387) | One historical retained core project, beyond 30 days. It argues against immediate archive; production use and new adoption remain unverified |
| New campaign projects independently reporting an own-application run/keep decision: **zero** | Installation and our fixtures do not establish dependency demand |
| PR 90 original-ID comparison: native / equally informed native / PSJ effects **2 / 0 / 0**, healthy **2 / 2 / 2**; PR 93 actual deferred approval: **5/5 PSJ and 5/5 small native** | Reusable evidence/identity policy is demonstrated, but superior protection or lower maintenance cost over the reasonable native alternatives is not |
| [Sidecar](https://github.com/nedonatelli/sidecar/issues/164#issuecomment-6179590817) confirmed the problem but declined the dependency/demo; [harness-kernel](https://github.com/rarebit-one/harness-kernel/issues/76#issuecomment-6264504755) published its own fix | Finding a real bug is not sufficient to sell the package; do not repeat declined invitations |
| Companion preserves native callbacks and continuation within its supported Chat Completions path, but excludes Responses/Messages, approval continuation and transforming schemas | First-use friction has been reduced, not eliminated; compatibility expansion still requires an actual adopter need |

GitHub's authenticated 14-day traffic snapshot reports 36 views / 8 unique
visitors, and 4,066 clones / 443 unique cloners for October 8–21. These are
different metrics; they do not isolate CI, operator traffic or customers.
No conversion rate is inferred. The repository has zero stars/forks at this
snapshot; popularity counters are not the decision criterion.

### Work permitted during the bounded continuation

- Maintain current core correctness, published installation and verified SDK
  compatibility. Fix a reproduced defect, an accepted pilot's concrete blocker
  or a proven regression; do not create features to fill the waiting period.
- Keep companion feature scope stable. Add no adapter or framework family
  without a willing project's specific integration requirement.
- Complete only the smallest flow chosen by a willing maintainer. Preserve
  their native checks, approvals and continuation, and compare the reasonable
  native alternative with the same original evidence. Accept a native choice
  as a valid negative result for the dependency.
- Record an own-project run, acceptance, later retention and 30-day retention
  separately. Count a project once across core and companion. The historical
  Sandbase project is not a new campaign win.
- Keep 200,000 rolling-30-day core downloads as the long-term objective and
  track companion separately. Do not generate installation loops or interpret
  downloads as active projects. The immediate decision metric is a verified
  new project's keep/remove result, not another release or another fixture.

The existing [read-only adoption workflow](https://github.com/canblmz1/prefix-safe-json/actions/runs/39790676971)
is active and its latest reviewed scheduled run passed. Its main configuration
still watches 30 threads. The two new Kept/AgentKit targets are prepared only
on this local branch; they are **not yet part of main's scheduled coverage**.
They were checked directly during this review. The existing review/merge
process must carry that small tracking diff; no protection or approval is
bypassed. No automatic outgoing reminders are authorized.

### Stop and continue criteria

By **November 21, 2026**, require at least one **new independent project** to
run the package in its own application and explicitly choose to retain the
integration, with a concrete reason. A positive response requesting a patch
is useful pipeline evidence but is not acceptance. Our PR, CI, fixtures or
download total cannot meet this gate. Subsequent use and 30-day retention
remain later evidence, not assumptions made at the first run.

If that gate is not met, stop active acquisition/feature investment and keep
only bounded maintenance for known users and reported defects. Reconsider
full archive when the known retained integration no longer needs the package
or sustainable maintenance cannot be provided. Silence from the two fresh
invitations after roughly one day is insufficient to make that decision.
Any actual archive/deprecation action is a separate explicit decision.

Current approved contacts and response classifications remain in
[the existing pilot log](ADOPTION_PILOTS.md#october-22-status-check-1838-utc).
This review sent no messages, created no new pilot and changed no runtime.
