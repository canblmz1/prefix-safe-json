# Own-project evaluation

The new integration reduces the first supported AI SDK path to a provider
factory and a normal call with ordinary tool callbacks. SDK-owned result
serialization and continuation are exercised by the
[installed guarded-chat example](../examples/guarded-chat/README.md).
The preview's full-response buffering and narrower tool policy remain costs
to evaluate, not reasons to assume a developer will adopt it.

## localmd: SDK-upgrade regression checks

The existing [history tests at the reviewed source](https://github.com/whitefoxx/localmd/blob/d5087f2a8c1b730ecc0b5dad00a33b2a8719e7e3/src/agent/run.test.ts)
explicitly retain tool-history assumptions that can change on SDK upgrades.
That is independent evidence of an existing maintenance task. Interest in a
PSJ dependency or repeated use has not been confirmed by the maintainer.

[Draft evaluation PR](https://github.com/whitefoxx/localmd/pull/1) adds four
original-SSE cases beside those tests. It keeps the project's AI SDK 7.0.29
and provider 3.0.11 pins and uses the public integration preview as a
development dependency. Its paired native/guarded positive controls retain
two complete results and the final answer. Ambiguous or malformed batches
must release no callbacks or continuation request.

Operator evidence:

- The existing two tests and the proposed four cases pass under the project's
  installed SDK and public preview tarball.
- The same two files also pass in an isolated SDK 7.0.143/provider 3.0.71
  consumer. That is a boundary test, not a whole-application upgrade claim.
- The isolated project typecheck and 1,551 unit tests pass. Proposed frozen
  dependency metadata passes `npm ci --dry-run`; no existing locked version
  changed.
- Full browser validation remains incomplete. The attempted suite encountered
  citation-picker and graph failures. The draft records that limitation and
  the additional serving warning in an unchanged-source browser control.

The application's existing `prepareStep`, provider selection and permission
flow stay in production. The proposed use is an offline SDK regression check;
the first guarded-chat adapter does not replace that broader agent loop.

## AgentUse: raw batches through the existing Code Mode runner

The existing [transport recovery tests](https://github.com/agentuse/agentuse/blob/4092f5bd4ef2c756116fd9d4b3e4e345187e688f/tests/model-stream-transport-drop.test.ts)
document repeated production interruptions. [Draft PR 25](https://github.com/agentuse/agentuse/pull/25)
adds eight authored comparisons through the installed provider parser, actual
runner, default-on Code Mode guest and dispatcher. It is not a reproduction
of the recorded production incidents or a production integration proposal.

At the retained AI SDK 7.0.128/provider 3.0.63 pins, both healthy controls run
two memory-only tools, pair both original result IDs and reach the final answer.
The native duplicate-ID response runs twice after the provider assigns a new
ID; a malformed sibling permits the valid sibling to run once. The evaluated
whole-response PSJ policy refuses both batches before any nested effect.
The runner already releases no nested effect on the length-finish control.
These are distinct policies, not automatic claims of SDK defects.

The eight new cases, 18 existing transport cases, source typecheck, a separate
strict check of the new test and frozen dependency installation pass locally.
Broader approval validation is not green: the existing lease file has 1 pass
and 19 failures, reproduced in an unchanged-source worktree in the same
environment with shared installed dependencies. That control does not prove
the cause or Linux behavior. Full release/dashboard/desktop validation was not
run; the public workflow enables verification only in the separate lab repo.

The patch adds published PSJ 0.6.1 as a development dependency and preserves
existing locked versions. The helper buffers finite authored responses; it
does not implement production capture, transport errors, approval or input
transformation contracts. The PR asks whether these checks justify retaining
the dependency for ordinary SDK upgrades. No independent run or repeated use
has yet been confirmed.

## Phoronis: a provider upgrade changes greeting-call identity

[Draft PR 12](https://github.com/skrylnikov/Phoronis-tg-bot/pull/12)
adds twelve authored SSE cases beside the existing mocked-SDK greeting tests.
The actual `chatGeneration` function and its inline administrator check run;
the Telegram API and repository are harmless spies. No production import or
existing locked version changes. The only added package is published PSJ 0.6.1
as a development dependency; AJV is already present.

An unchanged application/test snapshot produces different native update counts
for two calls sharing one original wire ID:

| Installed AI / compatible provider | Native update calls | PSJ preflight update calls |
| --- | ---: | ---: |
| 7.0.77 / 3.0.35, retained project pins | 0 | 0 |
| 7.0.77 / 3.0.71 | 2 | 0 |
| 7.0.143 / 3.0.71 | 2 | 0 |

The upgraded path returns one original result ID and one SDK-assigned ID. The
zero-update native expectation deliberately fails after the provider change;
the guarded case still passes. This is a concrete SDK-upgrade review task,
not a captured production incident or an automatic claim of an SDK defect.

Healthy controls retain one update, the original result ID and final answer.
Both non-admin controls retain zero updates. The current native length and EOF
cases already release no update; malformed-sibling behavior differs by the
chosen whole-response policy. The helper buffers finite fixtures, not live
traffic, and does not replace approval, normalization or transport handling.

Operator validation on retained pins: all 404 unit tests, the focused 26 cases,
source/test typecheck, lint and frozen installation pass on Windows with pinned
Bun 1.4.0 and Node 22.23.2. The full upgraded pair has 25 passing cases and one
expected native-policy failure across the same two files; typecheck passes.
That is boundary evidence, not complete application-upgrade certification.
Upstream Actions requires maintainer approval. Any separate run in the PSJ
maintainer's fork remains operator verification.

The PR asks whether the original-response checks justify retaining a development
dependency in ordinary provider upgrades. Independent use remains unconfirmed.

## Evidence still needed

The PRs ask whether the additional development dependency is worth retaining
in normal SDK-upgrade checks. A maintainer's own project run can establish
initial use. A later independently confirmed rerun after a lockfile update or
another incident can establish repeated use. A kept test, a rejected dependency
and a specific integration blocker are distinct outcomes to record.

Current stage: **operator-tested proposals, awaiting maintainer evaluation**.
New independent developers confirmed by these pilots: **zero**. CI initiated by
the PSJ maintainer, public downloads and a proposed patch do not change that
count. The campaign's five-developer goal remains open.

The existing four-hour adoption workflow tracks the PRs and surfaces public
feedback for manual review. It sends no reminders and does not infer adoption.

## Existing adopter maintenance

[Sandbase's dependency upgrade PR](https://github.com/sandbaseai/sandbase-harness/pull/965)
now pins published PSJ 0.6.1. Its unchanged 13 integration cases and all three
TypeScript programs pass locally. All eight checks on head `f2866b9` pass,
including Ubuntu's 3,670 passing tests, 19 recorded skips and two browser smoke
scenarios. Sandbase's integration is historical; the proposed upgrade is not
a new independent developer or confirmed maintainer deployment.
