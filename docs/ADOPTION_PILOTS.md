# Own-project evaluation

The new integration reduces the first supported AI SDK path to a provider
factory and a normal call with ordinary tool callbacks. SDK-owned result
serialization and continuation are exercised by the
[installed guarded-chat example](../examples/guarded-chat/README.md).
The 0.2 preview streams a conservative display-only prefix and can record
refused responses locally for wire-policy replay. Its narrower tool policy,
provisional text and replay scope remain costs to evaluate; the features do
not establish that a developer will retain it.

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

- The initial 0.1 preview's existing two tests and four proposed cases pass under the project's
  installed SDK and public preview tarball.
- Those same two files also pass in an isolated SDK 7.0.143/provider 3.0.71
  consumer. That is a boundary test, not a whole-application upgrade claim.
- The isolated project typecheck and 1,551 unit tests pass. Proposed frozen
  dependency metadata passes `npm ci --dry-run`; no existing locked version
  changed.
- Full browser validation remains incomplete. The attempted suite encountered
  citation-picker and graph failures. The draft records that limitation and
  the additional serving warning in an unchanged-source browser control.

The trial now pins the public integration preview **0.2.0** and adds three
Node-only checks beside those four cases: text before EOF while callbacks
wait, a recorded token-limited response, and an interrupted recording that
stays ineligible on offline replay. Healthy completion retains the original
result ID and final answer and creates no recording in default refused-only
mode. Captures use temporary directories that are removed afterward. The
source and installed provider remain at AI 7.0.29/provider 3.0.11.

The focused nine checks, full 1,554-test unit suite and project typecheck pass
in the operator's checkout. Only the preview package changes version; no
other existing locked version changes or new package is added. Node imports
follow the repository's existing test-only convention without widening its
browser types. These are authored offline cases, not independent use or a
captured production incident. The draft asks for the maintainer's own run,
installed versions and a keep/remove decision; recurring use needs a later
independently confirmed rerun after an actual SDK update or incident.

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

[Evaluation PR 12](https://github.com/skrylnikov/Phoronis-tg-bot/pull/12)
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

## harness-kernel: an existing consumer reports lost response evidence

The maintainer's [finishReason issue](https://github.com/rarebit-one/harness-kernel/issues/76)
reports a consumer receiving a length-limited response as an ordinary turn and
cut-off tool arguments as `{}`. That is independent problem evidence, not
interest in PSJ or confirmation of its use.

The [targeted evaluation invitation](https://github.com/rarebit-one/harness-kernel/issues/76#issuecomment-6255777258)
provides a [four-file runnable comparison](https://gist.github.com/canblmz1/df6707aaa4c3cf53813b2865c3e99c41).
It installs published `@rarebit-one/harness-kernel@0.10.0` and PSJ 0.6.1;
OpenAI SDK 7.38.0 is locked. Its unchanged compatible provider, actual SDK
parser and `runAgent` execute against authored non-streaming JSON responses.
The tool is an in-memory counter, and a global-fetch replacement prevents live
model calls. No kernel source is patched or copied.

All 16 paired cases pass after frozen installation on Node 22.23.2. Healthy
controls call once, retain the original result ID in the next provider request
and reach the final answer. The native length-limited, malformed, duplicate-key,
schema-invalid and missing-finish cases each call once; a malformed sibling and
duplicate original IDs each call twice. The compared policy releases zero
`tool.called` events or continuation requests for those batches. Native malformed
arguments become `{}`; duplicate argument keys retain the last value.

The custom complete-response mapper checks original ID uniqueness itself,
registers schemas from the actual request and uses PSJ's gate for raw argument
and schema decisions. Execution consumes one decision matching the original
ID, name and exact input. It is an evaluation helper, not a streaming adapter
or production transport implementation. Whole-response refusal is an explicit
policy, and no full kernel, live provider or consumer application is certified.

The invitation supports exposing finishReason independently and asks whether
retaining the PSJ comparison is useful for provider upgrades or whether native
regressions are preferable. The maintainer has not confirmed a run or recurring
use. This comparison adds zero developers to the adoption count.

On October 19, the [maintainer reported native fixes](https://github.com/rarebit-one/harness-kernel/issues/76#issuecomment-6264504755)
published as `0.11.0-next.1` under npm's `next` tag. The
[newly run 26-case comparison](https://gist.github.com/canblmz1/a0c387796fc2a724500169364285734c)
confirms that malformed calls and a length-limited terminal answer are refused
natively, with error results followed by a clean answer. A complete nonterminal
call on a length turn remains allowed intentionally. Cut prose retains the
native length outcome. The old 0.10.0 recipe is explicitly a preserved baseline.

The new public `argumentsText` and `finishReason` fields remove fetch
interception from the optional helper: `runConversation(guardAgentOptions(options))`.
It wraps the provider result and ordinary string-tool executors; the unchanged
SDK/kernel own HTTP handling, results and continuation. All 26 cases pass after
frozen installation, including exact original argument text, input and result
IDs. Extra batch/schema/identity refusal remains an optional application policy,
not a claim that the native fix failed. This is a one-run sequential evaluation
for the OpenAI dialect, without general approval, concurrency, cancellation or
production certification. The [material follow-up](https://github.com/rarebit-one/harness-kernel/issues/76#issuecomment-6265509144)
acknowledges the native solution and offers the smaller development comparison.
The maintainer's native release is not PSJ adoption; no PSJ run is confirmed.

## Dedalus: local functions after malformed argument JSON

An [existing client/server tool PR](https://github.com/dedalus-labs/dedalus-agents-typescript/pull/15)
invites feedback on runner behavior. The [targeted response](https://github.com/dedalus-labs/dedalus-agents-typescript/pull/15#issuecomment-6256214676)
provides a [locked, five-file evaluation](https://gist.github.com/canblmz1/1f425c53a2bb13d74e320d47358111b9)
through published `dedalus-labs@0.1.0-alpha.8`, its unchanged client/parser,
`DedalusRunner` and plain-function registry. No SDK source is patched or copied.

All 30 native/PSJ-policy cases pass on Node 22.23.2 after frozen installation.
In JSON and SSE modes, malformed original arguments become `{}` and reach the
native memory-only function; its successful result appears in the next SDK
request. Healthy single/two-call controls retain exact inputs, both original
result IDs and the final answer. The tested PSJ policy refuses malformed, length-limited, duplicate-ID,
schema-invalid and incomplete-SSE cases before a callback or continuation.
Whole-batch refusal and schema checks remain explicit application choices.

The finite-fixture preflight uses the wire adapter for SSE and an explicit
complete-JSON mapper that checks original ID uniqueness itself. Bare functions
receive no call ID from this runner: callback binding relies on verified
sequential fixture order plus exact name/input; result IDs are checked in the
next request. It is not general concurrent dispatch or approval binding.

The trial covers only plain local functions, without remote MCP or provider
execution. It is not a production transport wrapper or full SDK/app validation.
PR head `f5cd48c` was read but not built/run; new ToolDefinition, Zod and client
continuation behavior is unverified. This is existing published behavior, not
a claimed regression introduced by that PR. Native parse-error checks remain
useful independently. Own-project or recurring PSJ use is still unconfirmed.

## NoteGen: run the comparison in the actual checkout

The [draft test PR](https://github.com/codexu/note-gen/pull/1298) adds
`pnpm test:agent-boundary`, one exact development dependency on PSJ 0.6.1,
the test and scope documentation. Its 11-line lock addition reuses the
project's existing Ajv 8.20.0. No application source or production dependency
changes. This removes the separate source-download/setup step of the
[standalone recipe](https://gist.github.com/canblmz1/ebc99297eb380288782bd5757b90913a).

The checkout's unchanged runtime, context manager, permission engine, retry
manager, queue and recorder run with explicit provider/application-service
stubs. The provider supplies finite chunk-object iterables, and the registered
read tool records inputs in memory. Unknown imports fail before evaluation;
unexpected network, MCP, store, skill or image access throws. The trial does
not run the Rust SSE decoder, Tauri host, real provider, approval workflow,
argument repair, note mutation or desktop/mobile UI. Raw HTTP-byte preservation
is outside its boundary.

All 24 native/guarded cases pass. Healthy one/two-call controls assert exact
inputs, original result IDs in the next request and the final answer. Native
malformed-JSON, iterator-error and user-stop controls already prevent callbacks.
The optional PSJ policy additionally refuses length/content-filter completion,
missing finish evidence, late provider errors, duplicate IDs, schema-invalid
input and malformed siblings. Whole-batch/schema refusal is explicit. Its
one-shot ID/name/input binding is verified for these sequential fixtures only.
Other native outcomes are observations; a native refusal is accepted rather
than freezing permissive behavior as a required contract.

Windows Node 22.23.2 passes frozen installation, the new 24 cases, five existing
helper cases, full type checking, test-file lint and the plugin protocol check.
The [fork's Linux Node 24.21.0 verification](https://github.com/canblmz1/note-gen/actions/runs/39176480055)
passes the same 24/five cases and protocol check, after asserting exact source
head `7ff5fcd`. Its manual workflow stays in the fork. A temporary native
terminal/error check also passes all 24 cases; the original runtime bytes were
restored afterward and no native patch is proposed. These are operator runs,
not independent use or full application compatibility. The PR asks whether
retaining this development check earns its dependency and maintenance cost.

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

A separate [default-branch check](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/package.json)
on October 19 finds the historical PSJ **0.5.0** dependency still retained.
The [default strategy](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts)
still imports the execution lock and constructs the guard in its agent path.
The [October 12 CI run](https://github.com/sandbaseai/sandbase-harness/actions/runs/38202171387),
triggered by `AllureCurtain` pushing that same `427b52a` head, passes all four
jobs. Its log includes three passing `post-terminal-authority` integration
cases, 3,670 passing tests, 19 skips and two browser smoke cases. This is
independent evidence that the older integration remains in maintained code
and CI. It does not verify deployment, adoption of the proposed 0.6.1 upgrade,
use of the new 0.2 preview features or another new developer for the campaign.
