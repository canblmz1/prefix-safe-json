# Product evidence and next trials — October 21, 2026

Historical snapshot: the source/status statements below describe October 21
before the UTF-8 PRs merged. Current main is core 0.6.3 at
`deab898cf4eb96fa7600ef37926e3ceaddcadb77`; PRs 91, 92 and 94 are merged.
The original measurements and exact published-package pins remain unchanged.
See the [October 22 decision](ADOPTION_DIAGNOSIS.md#october-22-2026-continue-or-archive)
and [current pilot log](ADOPTION_PILOTS.md) for later evidence.

This snapshot does not claim five users or forecast growth. The goals are five
independent projects accepting and retaining an integration, and 200,000 core
downloads in a rolling 30-day window. Companion downloads are separate.
Downloads do not measure unique users or active projects.

## Engineering remains separate

Reviewed main is `bb807b39869a400f5fb5e000dc0556a86c084fde`. The malformed UTF-8
prefix fix is already in [PR 92](https://github.com/canblmz1/prefix-safe-json/pull/92),
branch `fix/invalid-utf8-prefix-invariance-20261021`, commit
`374ecf7c2f1804929e7950ec767e561db7d081c6`. It is open and unmerged. Growth work
does not change that branch or [BOM PR 91](https://github.com/canblmz1/prefix-safe-json/pull/91).
Merge decisions remain with Kübra; no release or publication is included here.

The same eight bytes, `{"a":1}` followed by `FF`, were rechecked on October 21:

| Source | Single chunk stable value | Split at byte 7 stable value | Execution |
| --- | --- | --- | --- |
| Current main | undefined | `{a:1}` | Refused in both |
| PR 92 head | `{a:1}` | `{a:1}` | Refused in both |

The fixed paths also agree on `E_INVALID_UTF8`, offset 7 and the complete event
sequence. This is a preserved-value/event correctness bug, **not an execution
bypass**. [Before](evidence/2026-10-21/utf8-before.jsonl) and
[after](evidence/2026-10-21/utf8-after.jsonl) are fresh source runs.

The original test-only commit `81b64ab7c50513e8cf215ecfea38a808fc9e6648`
demonstrated 137 failing / 20 passing new parser cases before the fix; all
157 passed afterward. This turn reran those and the eight decoder cases:
**165/165 passed**, using `pnpm exec vitest run test/invariants/invalid-utf8-prefix.test.ts test/unit/utf8-prefix-boundary.test.ts --maxWorkers=1`
in the fix worktree, pnpm 10.33.1 / Node 22.23.2 / Windows build 26200.

All [16 checks on that exact fix commit](evidence/2026-10-21/utf8-checks.json)
are complete/success. The [CI run](https://github.com/canblmz1/prefix-safe-json/actions/runs/39571366483)
includes 1,798 passing tests, typecheck, lint, build, corpus, coverage, the SDK
matrix and packed consumer checks. Independent read-only review found no
correctness/scope blocker. Earlier local full-suite verification had 1,796
passes and two CLI child-process empty-output failures; that file separately
passed 10/10. Its local failure cause remains unproven. Do not describe that
local full run as green. No fix code is added again in this evidence PR.

## Measured download baseline

Retrieved October 21 at approximately 09:01 UTC from npm's public Downloads API.
The explicit window **September 21–October 20 inclusive** contains 30 completed
UTC days. The point total and sum of all 30 daily records both equal **3,162**.

| Package | Last 30 complete days | Goal / remaining | Source |
| --- | ---: | --- | --- |
| prefix-safe-json | 3,162 | 200,000 / 196,838 remaining | [npm point API](https://api.npmjs.org/downloads/point/2026-09-21:2026-10-20/prefix-safe-json), [daily API](https://api.npmjs.org/downloads/range/2026-09-21:2026-10-20/prefix-safe-json) |
| psj-ai-sdk | Unknown | Tracked separately | [Point API](https://api.npmjs.org/downloads/point/2026-09-21:2026-10-20/psj-ai-sdk) and [daily API](https://api.npmjs.org/downloads/range/2026-09-21:2026-10-20/psj-ai-sdk) both HTTP 404, `package psj-ai-sdk not found` |

The companion's [registry metadata](https://registry.npmjs.org/psj-ai-sdk/latest)
returns HTTP 200 and version 0.3.2. A missing downloads response is **not zero
downloads** and does not mean the package is unpublished. No cause is inferred.
The [raw receipts and baseline](evidence/2026-10-21/baseline.json) preserve dates,
URLs, statuses and registry versions. These unadjusted npm totals do not
distinguish CI, operator installs or real use.

## One scenario, with a fair native control

The [runnable original-ID evaluation](../examples/raw-id-policy/README.md)
uses published core 0.6.2 / companion 0.3.2, AI 7.0.148 and compatible provider
3.0.75, current registry versions at measurement. An original-ID collision
releases **2 / 0 / 0** actual in-memory updates for native / raw native check /
PSJ. Healthy controls release **2 / 2 / 2**, with original IDs, tool results and
continuation preserved. Both preflight paths make zero unnecessary refusals
on that healthy fixture and one correct refusal on the collision fixture.
Input bytes and initial application requests are hash-checked for equality.

The small native alternative gets original bytes too. **No protection advantage
over that alternative is demonstrated.** PSJ supplies the original-ID policy
beyond the SDK default, but this scenario does not justify claiming a necessary
dependency. No traffic frequency, incident rate or performance advantage is
claimed. Buffering, added packages, local code maintenance and supported-subset
costs are documented; fewer call-site lines do not prove lower integration cost.

All six cases pass after a fresh source-only strict-peer/engine npm install
(19 packages, separate empty cache, no prior modules or links), Windows 11
build 26200, Node 22.23.2/npm 10.9.8. Public imports only. Raw output is
[committed](evidence/2026-10-21/raw-id-windows.jsonl). The CI job repeats this
isolated install and retains its own output; no Linux result is inferred
from the Windows result.

The existing 21-case comparison also passes unchanged on that same latest
pair. Its [raw rows](evidence/2026-10-21/native-controls-windows.jsonl) preserve
the SDK's existing JSON/schema/finish behavior: a malformed or schema-invalid
sibling allows one valid callback and an error result; length/missing-finish
already allow zero. The older normalized-ID check is a distinct, weaker
boundary than the raw-ID alternative above; it does not prove a small native
original-ID check is impossible.

## Adoption evidence, with dates and scope

The authenticated read-only watcher checked **31/31** configured threads at
09:00 UTC, with **zero API failures** and **zero integration reports**. Its
only newly unreviewed human reply is [October 20's LangChain update](https://github.com/langchain-ai/langchainjs/issues/11469#issuecomment-6294109525):
the benchmark author opened [native fix PR 11994](https://github.com/langchain-ai/langchainjs/pull/11994)
and corrected an earlier PR's status. This is native-fix work, not PSJ evaluation.
The watcher configuration records the reviewed body hash. No outgoing reminder
or message was sent.

| Evidence stage | Newly acquired projects / companion | Historical core evidence |
| --- | --- | --- |
| Independent own-application evaluation reported | 0 verified | Sandbase's independently authored/accepted runtime integration |
| Integration accepted | 0 verified | [Sandbase PR 80](https://github.com/sandbaseai/sandbase-harness/pull/80), merged by `liyangbing` on August 30, core 0.4.2 |
| Continued use after initial trial | 0 verified | Current default head `427b52a96a5309ca23268407f85c237468ab6a4e` retains core 0.5.0 and runtime guard |
| At least 30 days retained | 0 verified for companion | [October 12 CI](https://github.com/sandbaseai/sandbase-harness/actions/runs/38202171387), independently triggered by `AllureCurtain`, succeeds 43 days after acceptance |

Sandbase's [dependency](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/package.json)
and [runtime guard](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts)
were rechecked today. This supports retained integration in maintained source
and CI for more than 30 days, **not daily operation or production deployment**.
It is one existing core project, not a newly acquired companion user. Its
[0.6.1 upgrade PR 965](https://github.com/sandbaseai/sandbase-harness/pull/965)
remains open/unmerged. Do not count it again. Public evidence cannot rule out
unreported or private use.

## Three development trials, not three accepted buyers

All are existing contacts; no duplicate PR or new solicitation was created.
Qualification means an existing application maintenance task plus a supported
**pre-execution development-test boundary**. None has confirmed an unmet need
for a production PSJ dependency. Current PR metadata is in
[reviewed PRs](evidence/2026-10-21/reviewed-prs.json).

| Candidate / independent task evidence | Environment at candidate | Pre-execution feasibility and limits | Prior contact / smallest step |
| --- | --- | --- | --- |
| [localmd](https://github.com/whitefoxx/localmd): existing [tool-history tests](https://github.com/whitefoxx/localmd/blob/d5087f2a8c1b730ecc0b5dad00a33b2a8719e7e3/src/agent/run.test.ts) pin behavior during SDK changes | Node tests, AI 7.0.29 / provider 3.0.11, exact companion 0.3.2 dev dependency | Original SSE enters custom test fetch before normal callbacks. Production browser/provider/permission and broader prepareStep loop are not migrated | [Draft PR 1](https://github.com/whitefoxx/localmd/pull/1), head `fefb45e6256f0bf057bb21e8bbb94a31663aca55`, no independent review/run. Run existing nine tests + typecheck; decide keep/remove |
| [AgentUse](https://github.com/agentuse/agentuse): [transport-recovery tests](https://github.com/agentuse/agentuse/blob/4092f5bd4ef2c756116fd9d4b3e4e345187e688f/tests/model-stream-transport-drop.test.ts) document recurring interruptions | Node >=22 target, Bun test runner, AI 7.0.128 / provider 3.0.63, core 0.6.1 dev dependency | Finite raw-SSE preflight precedes actual runner/Code Mode dispatcher. A core test helper, not companion migration of approvals, leases or transforming schemas | [Draft PR 25](https://github.com/agentuse/agentuse/pull/25), head `7d8a66cb4aee6b9faa0dd65ec2c0f315ddd76a12`, no comments/reviews. Run eight comparisons and existing transport file separately; decide whether identity/group policy earns a dev dependency |
| [Phoronis](https://github.com/skrylnikov/Phoronis-tg-bot): [chatGeneration/greeting update](https://github.com/skrylnikov/Phoronis-tg-bot/blob/e64a85ec05092fb1e6c0e44b7fc56c133559064a/src/ai/chat-generation.ts) has real update callbacks and inline admin checks | Node/Vitest evaluation, Bun 1.4.0 application; retained AI 7.0.77 / provider 3.0.35 lock, core 0.6.1 dev dependency | Fixture raw-SSE preflight precedes actual chatGeneration; DB/Telegram are spies. Production Bun and transforming greeting schema are not certified companion paths. Conditional development-test fit only | [PR 12](https://github.com/skrylnikov/Phoronis-tg-bot/pull/12), head `b84198e03a86d779f56d2308655c203103f021b2`, no comments/reviews. Run wire tests; ask whether an upgrade identity-policy check matters before proposing runtime changes |

The [pilot log](ADOPTION_PILOTS.md) retains prior operator results and known
full-application limitations; they are not rerun or relabelled independent
evidence here. [Three invitation drafts](MAINTAINER_TRIAL_DRAFTS_20261021.md)
include exact heads, commands, expected results and the keep/remove question.
They are drafts for a willing maintainer or authorized follow-up on existing
PRs, not repeated unsolicited reminders.

No projects were added to fill a quota. Exclusions:

- `agent-cutoff-bench`: both native and PSJ already release zero updates for
  cutoff fixtures; a negative control, not an added-protection claim.
- `harness-kernel`: the reported issue received a native fix; additional demand
  is unconfirmed. `NoteGen`: original HTTP bytes and Rust/Tauri are unverified.
- Sandbase is existing-adopter maintenance; LangChain's native fix is outside
  this companion adapter. Sidecar declined both dependency and demo; do not
  invite again.

## Next small work package

Technical artifacts are ready for review. Next is **one willing localmd
maintainer's nine-test run and keep/remove reason on the existing candidate**,
then a dated rerun on a real SDK upgrade if retained. This distinguishes useful
recurring checks from our fixtures. It requires an independent decision; no
response is fabricated and silence does not justify a new feature. External
sending needs authorization. Re-query the same npm window convention at the
next snapshot; companion downloads stay unknown until usable data arrives.
No artificial downloads or installation loops pursue the download goal.
