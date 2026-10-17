# Adoption diagnosis — 2026-10-17

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
