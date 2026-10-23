# Own-project evaluation

The [October 21 product snapshot](PRODUCT_BASELINE_20261021.md) records current
downloads, dated historical retention evidence, development-trial candidates
and a comparison with a raw-capable native alternative. A prepared pilot is
separate from accepted use.

The dated operator history below is retained. For current contact states,
published versions and the next proposed messages, see
[the October 23 discovery checkpoint](#october-23-2026-discovery-checkpoint).

The new integration reduces the first supported AI SDK path to a provider
factory and a normal call with ordinary tool callbacks. SDK-owned result
serialization and continuation are exercised by the
[installed guarded-chat example](../examples/guarded-chat/README.md).
Published companion 0.3.2 streams a conservative display-only prefix and can record
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

The earlier trial pinned the public integration preview **0.2.0** and added three
Node-only checks beside those four cases: text before EOF while callbacks
wait, a recorded token-limited response, and an interrupted recording that
stays ineligible on offline replay. Healthy completion retains the original
result ID and final answer and creates no recording in default refused-only
mode. Captures use temporary directories that are removed afterward. The
source and installed provider remain at AI 7.0.29/provider 3.0.11.

The focused nine checks, full 1,554-test unit suite and project typecheck passed
in that operator checkout. Only the preview package changed version; no
other existing locked version changes or new package is added. Node imports
follow the repository's existing test-only convention without widening its
browser types. These are authored offline cases, not independent use or a
captured production incident. The draft asks for the maintainer's own run,
installed versions and a keep/remove decision; recurring use needs a later
independently confirmed rerun after an actual SDK update or incident.

The application's existing `prepareStep`, provider selection and permission
flow stay in production. The proposed use is an offline SDK regression check;
the first guarded-chat adapter does not replace that broader agent loop.

### Published 0.3.2 candidate, October 20

The [same draft PR](https://github.com/whitefoxx/localmd/pull/1) now advances
`694e4146c14b589a79f0d3f39a54f62c4dda7479` to
[`fefb45e6256f0bf057bb21e8bbb94a31663aca55`](https://github.com/canblmz1/localmd/commit/fefb45e6256f0bf057bb21e8bbb94a31663aca55).
Manifest and lockfile pin npm-published **`psj-ai-sdk: "0.3.2"`**. All other
locked versions and the three existing test files remain unchanged. Production
code and the provider loop remain unchanged.

Both the old and new candidates install from scratch on local Windows 11
build 26200, Node 22.23.2 and npm 10.9.8, with separate empty caches, no prior
`node_modules`, junction or overlay, and strict peer checks enabled. The command
is `npm ci --ignore-scripts --strict-peer-deps --no-audit --no-fund --prefer-online`.
Each installs 696 packages. The first new-candidate attempt failed with
`ECONNRESET`; a different clean directory/cache then succeeded. The earlier
`TAR_ENTRY_ERROR UNKNOWN` did not recur; its cause and resolution remain
unproven. The clean new candidate passes all nine focused cases and typecheck.

The [separate fork verification](https://github.com/canblmz1/localmd/actions/runs/39421488268)
checks old/new sources on Windows and Ubuntu with Node 22.23.2/npm 10.9.8.
All four jobs pass the nine focused cases, typecheck and 1,554 unit tests.
The full browser results are:

| Candidate | Windows browser cases | Ubuntu browser cases |
| --- | ---: | ---: |
| Old 0.2.0 pilot | 99/100 | 98/100 |
| New 0.3.2 candidate | 100/100 | 97/100 |

The new Windows job passes its final required-check gate. The overall workflow
fails because the other browser jobs fail. Only DOCX fails in both Ubuntu
controls; the other UI failures have not been attributed to a root cause.
This is not a claim that every failure was pre-existing or that Linux is green.
The workflow stays outside the upstream PR.

Local Git `core.autocrlf=true` also changed site Markdown to CRLF and broke
the existing static-page tests in both old and new sources. Restoring the
committed LF bytes makes the old static-page control pass. The trial's clone
command sets `core.autocrlf=false` and `core.eol=lf`; this was checked in a
fresh source clone. No application parser change is proposed.

The [maintainer instructions](https://github.com/canblmz1/localmd/blob/fefb45e6256f0bf057bb21e8bbb94a31663aca55/docs/tool-stream-regression.md)
give the exact published install and nine-test command and ask whether this
check earns its dependency during SDK upgrades. Technical preparation is
complete. Independent evaluation and subsequent use remain unconfirmed.

## agent-cutoff-bench: paired SDK completion policies

A [new independent LangChain report](https://github.com/langchain-ai/langchainjs/issues/11469#issuecomment-6273127102)
links a runnable cross-framework cutoff benchmark. It establishes a current
native parsing problem; it does not report PSJ use. Its own Python patch already
prevents the truncated writes, and its valid-sibling case prefers retaining
the complete call instead of refusing the whole group.

[Draft PR 1](https://github.com/simin-yuan/agent-cutoff-bench/pull/1), head
`e28b5c42c7ae968c35130561d3225983d2559c83`, adds an optional isolated npm
consumer with published companion 0.3.2/core 0.6.2 and paired native AI SDK
7.0.146/provider 3.0.74. The existing server, four fixtures, LangChain versions
and default matrix remain unchanged. This is not a LangChain production adapter.

All eight cases pass in a source-only Windows consumer after strict-peer
`npm ci` with a separate empty cache and no prior modules or links. Both
clients write the healthy 2,120-byte report once, preserve `call_bench_1` in
callback and continuation, and receive the final answer. Both clients release
zero callbacks and write no file for `length`, `drop` and `reset`.

On `length/drop`, native AI SDK sends an invalid-input tool result and the
fake server then answers `Done.`; PSJ refuses without continuation. The server
answers after any tool result, including errors; this does not mean the SDK
reports a successful write. Inspecting native error results remains an
alternative. There is **no additional callback/disk protection demonstrated**
by PSJ on these fixtures. The
[raw records and clean-install receipt](https://github.com/canblmz1/agent-cutoff-bench/tree/e28b5c42c7ae968c35130561d3225983d2559c83/harness/ai-sdk/results)
preserve the operator run. No Linux or real-provider run is claimed.

The draft asks whether the maintainer would retain the optional paired row
for SDK upgrades or prefer the native row alone. No independent run, keep/remove
decision or retained PSJ use has been reported. This adds zero developers to
the five-developer count.

### October 22: replace the mismatched proposal with the actual LangGraph path

The user's instruction to continue acquisition advanced the offer review;
it did not establish maintainer demand for a PSJ dependency. The earlier
AI SDK row already prevented the reported writes and did not exercise the
author's affected LangGraph path. The same draft PR now contains
[`edc32a0b533df075724d3aebd9dba11d53263890`](https://github.com/canblmz1/agent-cutoff-bench/commit/edc32a0b533df075724d3aebd9dba11d53263890),
normally fast-forwarded from the original proposal, with no rewritten history
or duplicate PR. Its old files remain accessible at the historical commit.

The replacement uses the existing `ChatOpenAI -> createReactAgent -> write_file`
and real temporary-file path, unchanged server fixtures and original tool
schema. Published core **0.6.3** is an optional development dependency;
no production adapter or framework API was added. The original default
runner remains available without the optional fifth argument.

| Existing fixture | Native | Small raw-native check | PSJ |
| --- | --- | --- | --- |
| Complete | One 2,120-byte, 40-line write | Same | Same |
| Length cutoff | One truncated 866-byte write | No write | No write |
| Clean EOF/drop | One truncated 866-byte write | No write | No write |
| TCP reset | No write; transport error | Same | Same |

Two separate source-only Windows 11 build 26200 installations used Node
22.23.2, npm 10.9.8 and Python 3.12.10 with strict peers, no prior modules,
links or overlays. The retained core/OpenAI/LangGraph **1.2.18/1.6.2/1.5.1**
pins pass **12/12**. A separate validation on current registry
**1.3.0/1.7.0/1.5.2** also passes **12/12** in one invocation; those pins do
not replace the benchmark manifest. Both use Zod 4.6.7 and PSJ 0.6.3.

In guarded length/drop runs, one callback attempt becomes an error
ToolMessage before any disk write; original result ID `call_bench_1`, two
model requests and the fake server's `Done.` remain. Complete/length/drop
argument and lifecycle fingerprints match across clients except volatile
timestamps. Real TCP reset delivery can differ and is reported as transport
controls, not identical delivered inputs. The first retained run failed on
pre-header fetch capture bookkeeping; its eleven records are preserved,
the observer was corrected and zero-write expectations were not relaxed.

[Trial instructions, limitations, exact locks and raw records](https://github.com/canblmz1/agent-cutoff-bench/blob/edc32a0b533df075724d3aebd9dba11d53263890/harness/js/RESULTS.md)
make the next action `npm ci --ignore-scripts --strict-peer-deps --no-audit
--no-fund`, then `npm run test:raw-policy` in `harness/js` with Node 22+ and
Python 3. Two operator reviews found no concrete correctness/fairness blocker.
This is an operator experiment: native-check and PSJ give equal outcomes;
lower maintenance cost and independent use remain unverified. It does not
replace the author's still-open [native fix 11994](https://github.com/langchain-ai/langchainjs/pull/11994).

After explicit approval of the exact candidate, PR title/body and one comment,
[the material update](https://github.com/simin-yuan/agent-cutoff-bench/pull/1#issuecomment-6350775744)
was sent at **20:37:33 UTC**. API readback verified the head, preserved draft
state, exact approved body and one posted comment. No other invitation or
automatic reminder was sent. The maintainer's own run and keep/remove decision
are pending; newly confirmed independent projects remain **zero**.

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
count. The campaign's goal of five independent projects remains open.

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

## October 21, 2026 outreach checkpoint (work order 009)

Status: **three approved messages sent on October 21; independent replies pending**.
Two are first-contact development-test proposals to newly screened projects;
one supplies new evidence to the existing Sandbase contact. No application
integration, external PR, release or deployment was made.
These are qualified evaluation offers, not confirmed unmet production needs.

### Publication closure and measured baseline

Reviewed PSJ main/tag `v0.6.3` is
`deab898cf4eb96fa7600ef37926e3ceaddcadb77`.
`pnpm verify:published-release 0.6.3` passed on Windows build 26200,
Node 22.23.2 / pnpm 10.33.1. The existing verifier installed the registry
package into an empty temporary consumer using npm 11.19.0, checked registry
integrity and cryptographically verified its npm attestations. Provenance
binds the exact package to that commit and
[publish run 39645764793](https://github.com/canblmz1/prefix-safe-json/actions/runs/39645764793).
All 181 published/rebuilt files agree; the tarballs are byte-identical.
Registry tarball SHA-256:
`ee7899a056da8701facd15e9d570f45de289ee724bce2297000c7d1fcf5d3c72`.
Registry integrity:
`sha512-g0yIn1I9juITXL8/BUjsx7FsXa5fTJ3dgEatK/SPGXYgJggGnK29OF5kL7JVrqtd+y/ZX55cSP3kQS21MghNcQ==`.
The unchanged `scripts/runtime-package-smoke.mjs`, copied into that clean
consumer and run there, passed public imports, parsing, gate/guard, adapters,
one-shot authority and exports checks. Verification closed within 30 minutes;
no full test matrix, mutation or long fuzz was rerun. The initial mistaken
`--version 0.6.3` invocation failed usage and is not counted as successful.
The [release](https://github.com/canblmz1/prefix-safe-json/releases/tag/v0.6.3)
already existed; this task did not approve or perform publication.

At approximately 20:19 UTC the
[npm point API](https://api.npmjs.org/downloads/point/2026-09-21:2026-10-20/prefix-safe-json)
returned **3,162** core downloads for September 21 through October 20 inclusive
(30 completed UTC days), against the 200,000 goal. The companion
[downloads endpoint](https://api.npmjs.org/downloads/point/2026-09-21:2026-10-20/psj-ai-sdk)
returned HTTP 404: its download count is **unknown**, not zero. Published
companion 0.3.2 remains a separate package. Downloads do not establish users.

### Existing contacts and independent evidence

The existing read-only watcher checked 30/30 main-configuration threads with
zero API failures. Local receipts are retained under the ignored
`artifacts/work-order-009-20261021/` audit directory. No outgoing message was
sent by the watcher. Two LangChain replies report
[a still-observed cutoff problem](https://github.com/langchain-ai/langchainjs/issues/11469#issuecomment-6273127102)
and [native fix work](https://github.com/langchain-ai/langchainjs/issues/11469#issuecomment-6294109525),
not a PSJ trial; PR 90 already records their review classification. Sidecar
[declined both a dependency and the demo](https://github.com/nedonatelli/sidecar/issues/164#issuecomment-6179590817);
it is excluded from further invitations. Native fixes in multi-llm-ts,
ai-sdk-ollama and harness-kernel remain native fixes, not PSJ adoption.

| Existing contact | Current reviewed state | Action in this checkpoint |
| --- | --- | --- |
| [Sandbase 965](https://github.com/sandbaseai/sandbase-harness/pull/965) | Open, head `f2866b9f7bf331c0479ac93364234f4afc81653c`; no maintainer comment/review on upgrade PR | Sent the new equal-result update below; no request to rerun |
| [localmd 1](https://github.com/whitefoxx/localmd/pull/1) | Draft, head `fefb45e6256f0bf057bb21e8bbb94a31663aca55`; companion 0.3.2 candidate; no independent response | Existing invitation stands; no repeat |
| [AgentUse 25](https://github.com/agentuse/agentuse/pull/25) | Draft, head `7d8a66cb4aee6b9faa0dd65ec2c0f315ddd76a12`; no comments/reviews | Existing invitation stands; no repeat |
| [Phoronis 12](https://github.com/skrylnikov/Phoronis-tg-bot/pull/12) | Open, head `b84198e03a86d779f56d2308655c203103f021b2`; no comments/reviews | Existing invitation stands; no repeat |

Count projects once across core and companion: **one historical retained core
project (Sandbase), zero newly confirmed projects in this campaign**. Sandbase
[accepted its original integration on August 30](https://github.com/sandbaseai/sandbase-harness/pull/80)
and [independently ran successful CI on October 12](https://github.com/sandbaseai/sandbase-harness/actions/runs/38202171387),
43 days later; reviewed main still retains core 0.5.0. This establishes retained
source/CI integration beyond 30 days, not production deployment or a new user.
Neither another accepted integration nor five independent projects is verified.

### Fifteen new projects screened; two selected

These are source/issue reviews, not installed-application certifications.
No new candidate's application or integration tests were run in this task.

**Kept** — main
[`c99019e6612beed307d1bc635251d35ddf79e996`](https://github.com/keptinventory/kept/tree/c99019e6612beed307d1bc635251d35ddf79e996).
Its [write-proposal code](https://github.com/keptinventory/kept/blob/c99019e6612beed307d1bc635251d35ddf79e996/apps/server/src/assistant/proposals.ts)
stores parsed arguments plus a canonical hash and later executes only after
confirmation. [Existing SDK tests](https://github.com/keptinventory/kept/blob/c99019e6612beed307d1bc635251d35ddf79e996/apps/server/src/ai/call.tools.test.ts)
construct argument strings with `JSON.stringify`, so those fixtures cannot
represent duplicate argument members. This is a concrete argument-fidelity
review opportunity, **not evidence that Kept has suffered such an incident**.
[Node >=24 <25](https://github.com/keptinventory/kept/blob/c99019e6612beed307d1bc635251d35ddf79e996/package.json),
AI 7.0.116 and compatible provider 3.0.57 are within the relevant core runtime
and protocol conditions. Its model factory already accepts injected fetch;
tools have no SDK `execute` callback, leaving admission before proposal storage.

Smallest offer: one test file using published **prefix-safe-json@0.6.3** only
as a development dependency, with the current compatible provider and a finite
authored HTTP response. Feed the original `function.arguments` string to the
public core parser before SDK projection, then keep Kept's existing schema,
per-call sibling policy, confirmation, hash and replay controls. No companion
or production-loop migration is proposed; Kept uses non-streaming generation.
Compare healthy `update_thing` input with a duplicate `fields.name` member.
Measure persisted proposal arguments and actual database changes before,
after and on repeated confirmation. Proposed success: exact healthy proposal,
zero changes before approval, one approved change, none on replay; ambiguous
input is refused before persistence **if the maintainer wants that policy**.
Current JSON/schema/finish checks already cover ordinary malformed, invalid
and length cases. An equally informed native check with strict duplicate-member
parsing can implement the same policy. PSJ necessity and maintenance savings
are unproven. The maintainer reviews one scoped test and decides keep/remove;
the existing test database setup is reused. No previous contact found in the
watch record, existing drafts, discussion replies or account-authored issues.

**Upstash AgentKit** — main
[`7022274100404136bd92cb03e9bf67192d91158d`](https://github.com/upstash/agentkit/tree/7022274100404136bd92cb03e9bf67192d91158d),
with [active SDK upgrade PR 73](https://github.com/upstash/agentkit/pull/73)
at `68a2afc806fafd8b9d238192c7bb202f0217bcbc`.
That PR explicitly performs recurring upstream-compatibility work; it is not
PSJ interest. The [memory tests](https://github.com/upstash/agentkit/blob/7022274100404136bd92cb03e9bf67192d91158d/packages/ai-sdk/src/memory.test.ts)
invoke callbacks directly, whereas
[`save_memory`](https://github.com/upstash/agentkit/blob/7022274100404136bd92cb03e9bf67192d91158d/packages/ai-sdk/src/memory.ts)
persists through `AgentMemory.add`. Testing the provider-to-write boundary is
a specific possible addition to that upgrade review, not a claimed failure.
Node 24, main AI 7.0.133 / OpenAI provider 4.0.71; PR 73 locks AI 7.0.148 /
OpenAI 4.0.71. Keep each comparison on the same selected candidate lock.

Smallest offer: one scripted-provider `save_memory` check using the existing
isolated Redis user scope and cleanup, plus published core **0.6.3** as a dev
dependency. Reuse core's existing Responses stream adapter and retain original
call IDs/argument strings in the test fetch before the SDK consumes them.
The demo uses `openai(...)`'s Responses path: **companion 0.3.2 is not a drop-in
fit**, and no new adapter or route change is offered. Drain/preflight only the
finite test response before releasing it to the unchanged SDK callbacks.
Healthy success means one stored memory, original result ID and continuation;
an original-ID collision is evaluated against a proposed zero-write admission
policy, with equally informed raw-native and PSJ controls. Check Redis writes
and contents, not callback count alone. The SDK already parses JSON and
validates its tool schema; a native raw-ID/finish/schema ledger can enforce the
same admission policy. No advantage is demonstrated on this project's Responses
path yet. Reuse one memory index rather than creating an index per fixture;
PR 73's Redis quota/timing failures are not bugs PSJ claims to solve. Maintainer
burden: one focused test, an optional dev dependency and their existing test
Redis credentials. No previous account contact or invitation was found.

The remaining thirteen were not selected; absence of fit is not a claim that
their entire application is correct:

| Screened project / current primary evidence | Reason not to solicit a PSJ pilot now |
| --- | --- |
| [Mastra 27259](https://github.com/mastra-ai/mastra/issues/27259) | Transformed Standard Schema handling; PSJ deliberately does not promise transform support |
| [VoltAgent 1373](https://github.com/VoltAgent/voltagent/issues/1373) | Native SDK API alignment, with AI 6 in current core; no demonstrated need for another execution wrapper |
| [Dyad 4879](https://github.com/dyad-sh/dyad/issues/4879) | Sandbox/permission boundary; outside PSJ guarantees |
| [Open Lovable 232](https://github.com/firecrawl/open-lovable/issues/232) | Authentication/shared-sandbox issue; PSJ would not fix it |
| [Midday](https://github.com/midday-ai/midday) | No sufficiently specific current raw-argument need established in this screen |
| [n8n 41604](https://github.com/n8n-io/n8n/issues/41604) | Node/tool interface mismatch; supported pre-execution raw seam not established |
| [Cherry Studio 15244](https://github.com/CherryHQ/cherry-studio/issues/15244) | Capability exposure request, not evidence of argument-admission need |
| [Activepieces 16487](https://github.com/activepieces/activepieces/issues/16487) | Trace storage/observability request; does not establish a PSJ admission need |
| [Pi 11112](https://github.com/earendil-works/pi/issues/11112) / [9265](https://github.com/earendil-works/pi/issues/9265) | Current malformed calls already refuse execution; repair hooks and a separate incremental-performance patch are different work |
| [T3 Code 22995](https://github.com/pingdotgg/t3code/issues/22995) | Approval-card information from an external CLI; no established original-wire seam before that CLI executes |
| [Tambo backend](https://github.com/tambo-ai/tambo/blob/6e2c1bff3b68a00c094b6d876788cc8f33f7bb02/packages/backend/package.json) | AI 6/provider 2 excludes the companion; no specific need justifying core wiring was established |
| [Convex Agent 417](https://github.com/convex/agent/issues/417) | Native TypeScript intersection failure; unrelated to raw execution evidence |
| [Stagewise 1575](https://github.com/stagewise-io/stagewise/issues/1575) | PTY sentinel splitting, not tool-argument JSON |

Pi's previous `badlogic/pi-mono` URL redirects to `earendil-works/pi`, and
`get-convex/agent` redirects to `convex/agent`; each is counted once. No
additional project was selected merely to reach five.

### Fair comparison and outgoing approval package

[PR 90](https://github.com/canblmz1/prefix-safe-json/pull/90) compares the same
original-ID fixture with SDK defaults, equally informed raw-native controls
and PSJ: updates **2 / 0 / 0**, healthy updates **2 / 2 / 2**. In
[PR 93](https://github.com/canblmz1/prefix-safe-json/pull/93), actual Sandbase
deferred approval/persistence/file execution meets the five selected policies
in **5/5 PSJ and 5/5 small-native cases** (current native admission: 2/5).
That experiment retains the application's locked AI 7.0.128 / PSJ 0.5.0; it
does not certify a new runtime or another application's protocol. Both are
scripted experiments, not frequency/production evidence. No lower maintenance
cost or unique protection over the equally informed native alternative is
proven. Neither comparison was rerun in this outreach task.

The user approved all three exact comments below with "gonder" after reviewing
the prepared package. Each destination was checked for new replies and duplicate
messages before sending. API readback verified the posted author (`canblmz1`)
and exact approved body for all three. No repeated invitations to localmd,
AgentUse or Phoronis are included. No automatic follow-up is authorized.

| Message | Sent at (UTC), October 21, 2026 | Verified comment |
| --- | --- | --- |
| K | 20:28:58 | [Kept](https://github.com/keptinventory/kept/discussions/183#discussioncomment-19108457) |
| U | 20:29:07 | [Upstash AgentKit](https://github.com/upstash/agentkit/pull/73#issuecomment-6325845102) |
| S | 20:29:11 | [Sandbase](https://github.com/sandbaseai/sandbase-harness/pull/965#issuecomment-6325846401) |

Receipts and exact bodies are retained under the ignored audit directory's
`sent/` subdirectory. The existing watch configuration now includes the two
new public reply threads, prepared for the existing PR 90. Those additions
are not yet active in main's scheduled watcher. Sending does not
change the confirmed-project count.
The focused live watcher query checked both new threads successfully; its
existing Sandbase target timed out after 30 seconds (2/3 checked, one failure).
That query is recorded as partial failure, not a clean watcher run. The separate
GitHub comment readback above verified all three sends, including Sandbase.

#### K — Kept first contact

Destination: comment on
<https://github.com/orgs/keptinventory/discussions/183> (the existing ideas thread).
Discussion node: `D_kwDOUrd5ss4AqSoZ`. One idea; no new issue or PR.

> I maintain Prefix-Safe JSON. Your [write proposals](https://github.com/keptinventory/kept/blob/c99019e6612beed307d1bc635251d35ddf79e996/apps/server/src/assistant/proposals.ts) bind parsed arguments to confirmation cards, while the [SDK tests](https://github.com/keptinventory/kept/blob/c99019e6612beed307d1bc635251d35ddf79e996/apps/server/src/ai/call.tools.test.ts) construct inputs with JSON.stringify.
>
> I'd offer one development-only update_thing check using published prefix-safe-json@0.6.3: compare duplicate-member handling before proposal storage with an equally informed small native check, retaining your current SDK pins, validation, approvals and replay controls. We'd inspect stored arguments and database changes before/after confirmation; no production migration or incident claim. I'd prepare the test; your task would be one focused run and a keep/remove decision. PSJ's maintenance advantage is unproven.
>
> Would that original-argument check be useful in your existing proposal tests?

#### U — Upstash AgentKit first contact

Destination: comment on <https://github.com/upstash/agentkit/pull/73>.
No duplicate dependency-upgrade PR.

> I maintain Prefix-Safe JSON. This SDK upgrade is a concrete place to evaluate an optional provider-boundary regression: [memory.test.ts](https://github.com/upstash/agentkit/blob/7022274100404136bd92cb03e9bf67192d91158d/packages/ai-sdk/src/memory.test.ts) calls execute directly, while save_memory persists through AgentMemory.add.
>
> I can prepare one scripted-provider test using published prefix-safe-json@0.6.3, your candidate's exact AI/OpenAI versions and existing isolated Redis setup. It would compare native, small raw-native and PSJ admission for healthy and duplicate-original-ID responses, checking stored memories, result IDs and continuation. Your Responses path calls for core's existing adapter, not the Chat Completions companion; no production route change. Small native checks may give identical results; this would not address the quota/timing failures reported here.
>
> Would one scoped save_memory test earn a place in your SDK-upgrade checks?

#### S — Sandbase new comparison evidence

Destination: comment on <https://github.com/sandbaseai/sandbase-harness/pull/965>.
This is an evidence update to an existing adopter, not a new-user invitation.

> PSJ maintainer update: [comparison #93](https://github.com/canblmz1/prefix-safe-json/pull/93) now evaluates your actual deferred-approval flow on its pinned AI SDK 7.0.128 / PSJ 0.5.0. Existing PSJ and a small native raw-lifecycle check satisfy the same policy in all five selected cases, including persisted arguments, file writes after approval and repeat approval. Permissions and persistent replay controls stay unchanged.
>
> These are scripted cases, not provider incidents; we have not demonstrated a maintenance-cost advantage for PSJ. No rerun is requested, and this does not repeat the dependency upgrade.
>
> Would you prefer to retain PSJ or own the small native check, and what drives that choice?

Next action: review any independent response on these existing threads. A
positive reply leads to one selected flow's smallest reviewable test patch;
external PR permission is handled only when that diff is concrete. A decline
is recorded without another solicitation. Silence remains pending. The approved
send is complete; independent evaluation and the five-project goal remain open.

### October 22 status check, 18:38 UTC

No new independent PSJ acceptance or own-application run was verified. Kept's
invitation has no replies (including nested replies); Sandbase 965 has only
our evidence update. localmd 1, AgentUse 25 and Phoronis 12 still have no
independent pilot response or review.

Upstash collaborator `CahidArda`
[closed PR 73 as superseded by PR 74](https://github.com/upstash/agentkit/pull/73#issuecomment-6339971296).
This is upgrade-PR housekeeping, not acceptance or rejection of the PSJ offer.
[PR 74](https://github.com/upstash/agentkit/pull/74) is open with no comments or
reviews. No invitation was reposted there and no follow-up was sent. Newly
confirmed projects remain zero; Sandbase remains historical evidence only.

The roadmap stage 1 implementation preserves the existing 31 PR-branch
topics and adds the two sent invitations: 33 unique topics. Its
[reviewed live audit](evidence/2026-10-22/watch-reviewed.json) has zero API
failures, zero integration reports and no unclassified reply remaining.
The superseded AgentKit comment is acknowledged by its exact body hash,
without increasing acceptance. [The maintenance queue and validation](ADOPTION_DIAGNOSIS.md#october-22-execution-checkpoint-roadmap-stage-1)
are prepared in the same existing PR 90; scheduled main coverage still
depends on review and merge.

## October 23, 2026 discovery checkpoint

The existing watcher read all **33/33** topics without API failures at
06:48 UTC. One new response required review:
[TanStack maintainer confirmation](https://github.com/TanStack/ai/issues/1689#issuecomment-6357854447)
that [native PR #1750](https://github.com/TanStack/ai/pull/1750) is released and
malformed arguments now produce an error result without executing the tool.
This is native problem resolution, not PSJ acceptance. Its exact body hash is
reviewed; an edited response will require review again. No reminder was sent.
The updated benchmark PR #1 still has no independent run or keep/remove response.

The [npm downloads endpoint](https://api.npmjs.org/downloads/point/2026-09-23:2026-10-22/prefix-safe-json)
reports **3,146** core download events for September 23–October 22, checked at
07:07 UTC. The companion's corresponding endpoint returns 404, so its count
remains unknown, not zero. Neither number measures independent users. The
200,000-download goal and five-project goal remain unmet.

Two parallel source reviews and a parent review assessed 15 repositories:
13 new assessments and two rechecks. They found no demonstrated unmet need
requiring a PSJ dependency in the additional screen:

| Source | Current reason not to pitch a runtime dependency |
| --- | --- |
| [Kimi3220](https://github.com/MoonshotAI/kimi-code/issues/3220) | Bad tool names already refuse execution; valid model no-op intent cannot be inferred by PSJ |
| [Cherry Studio22467](https://github.com/CherryHQ/cherry-studio/issues/22467) | Rechecked for a different issue; approved native22479 handles replay. Original bad writer/prevention need remains unestablished |
| [Luoyu23](https://github.com/loater-opt/luoyu-open/issues/23) | Closed host/uni-app environment, no supported Node raw-execution seam established |
| [Anima363](https://github.com/anima-research/agent-framework/issues/363) | Existing unparseable-input flag supports a small local check; no independent PSJ need established |
| [Evener2725](https://github.com/prime-radiant-inc/evener/issues/2725) | Go adapter/rescue boundary, outside the selected Node surface |
| [bramburn/pi1088](https://github.com/bramburn/pi/issues/1088) | Requests tolerance for trailing data; current native refusal already matches PSJ's strict policy |
| [Nodal781](https://github.com/Kwintspiracy/nodal-agents/issues/781) | Post-write provenance/SQL/path questions, not original-argument admission |
| [OpenClaw63210](https://github.com/openclaw/openclaw/issues/63210) | Reported missing required field already fails schema validation; Bedrock route is not the existing raw adapter |
| [NVIDIA NIM25](https://github.com/BaUka0/nvidia-nim-provider/pull/25) | Native truncated-argument correction merged October3 |
| [vicoop209](https://github.com/planetarium/vicoop-bridge/issues/209) | Native dispatch correction212 merged May19 |
| [Meridian source](https://github.com/yunus-0x/meridian/blob/5ab14b476e4e8d25c58f989c77b161721e1a505f/agent.js#L264) | Repair code alone does not prove an unwanted policy; no independent malformed-admission report or isolated test established |
| [oh-my-pi11104](https://github.com/can1357/oh-my-pi/issues/11104) | Reporter confirmed stale version; native replay fix shipped. Separate execution tolerance is already an explicit policy choice |
| [codex-router797](https://github.com/duolahypercho/codex-router/issues/797) | Native800 already merged and refuses malformed completed calls |
| [Continue13223](https://github.com/continuedev/continue/issues/13223) | Our own earlier report, not new independent demand; native consumer/producer PRs13278/13373 are open. Actual effect protection not demonstrated |

Cherry and Continue are rechecks, not new independent discoveries. A narrow
search for all-before-any-effect policies found no additional qualified
project. These exclusions are not claims that the applications are generally
correct or that unreported/private PSJ use is impossible. A separate public
indexed-manifest search found only the historical Sandbase dependency and
no companion manifest; this is bounded search evidence, not a census.

### Strands: prepare a first needs-discovery question

The independent reporter in [issue #4158](https://github.com/strands-agents/harness-sdk/issues/4158)
already supplied the right native precedence fix in approved, still-open
[PR #4159](https://github.com/strands-agents/harness-sdk/pull/4159).
The real npm SDK **1.22.0** still contains that precedence issue; this was
checked in the actual registry artifact, not inferred from an old repository.
The first-contact question is whether a reusable raw reference earns a place
in upgrade tests, not whether another fix PR should replace the native work.

The [ready standalone reference](evidence/2026-10-23/strands-reference/README.md)
uses that reporter's two cutoff fixtures and one healthy control through the
actual published `Agent`, public model and callback. Two separate clean Windows
consumers pass **9/9 each** with SDK 1.22.0 / OpenAI 6.45.0 / core 0.6.3 / Zod 4.6.7.
The optional-schema no-argument cutoff calls once with `{}` natively; a public
subclass applying the native PR's condition and PSJ both call zero times.
Partial JSON already calls zero times natively. Healthy ID and continuation
are retained. This is scripted, memory-only callback evidence, not a file write
or hosted-provider incident. The native PR itself was not installed or changed.

Native `MaxTokensError` and PSJ's refusal wrapped as `ModelError` expose
different error contracts; recovery equivalence was not evaluated. No extra
callback protection or maintenance benefit
over the small native control was demonstrated. A discovery offer is prepared;
no new external message has been sent at this checkpoint. Maintainer interest,
own-project run, retention and newly confirmed projects all remain unverified.
