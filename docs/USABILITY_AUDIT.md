# Integration usability audit — October 19, 2026

Follow-up: PR #88 merged at `5ed764c`; companion 0.3.1 was submitted through
the protected npm publisher and its registry artifact now matches the tested
workflow artifact, with provenance. The table below records the earlier
0.2/0.3.0 audit state. Core 0.6.2 and companion 0.3.2 candidates separately fix
callable schemas and the whole-batch diagnostic gap; see the
[new regression evidence](BATCH_CONTRACT.md) and [evaluation kit](COMPANION_EVALUATION.md).

The core npm package is installable. The largest observed costs are in the
path from installation to an existing SDK application: a separate preview
artifact, an unnecessarily narrow option list, and ownership of the original
response before tools can run. Silence from an invited maintainer does not
establish which of these affected that person.

## Reproduced blockers and changes

| Developer task | Observed in preview 0.2.0 | Change in 0.3.0 | Evidence |
| --- | --- | --- | --- |
| Install the integration by its package name | `npm view psj-ai-sdk version --json` returns E404. The core package resolves to 0.6.1. | Registry publication remains outstanding. Install instructions now lead with the public artifact and distinguish an existing lockfile from a fresh project. | Registry lookup and the [installation instructions](../packages/ai-sdk/README.md#install-the-preview). |
| Keep ordinary generation settings | `instructions` and `reasoning` are rejected before a request. The same keys occur in localmd's existing agent call. | Accept instructions, reasoning, sampling controls, provider options and step-finish observation. | [Compatibility tests](../packages/ai-sdk/test/compatibility.test.mjs) and [the existing application call](https://github.com/whitefoxx/localmd/blob/d5087f2a8c1b730ecc0b5dad00a33b2a8719e7e3/src/agent/run.ts). |
| Enable registered tools between steps | Every `prepareStep` callback is rejected, including a callback returning only `activeTools` and messages. | Accept a checked subset. Each request uses its actual active wire schemas; inactive calls refuse. Model, tools, execution-context and sandbox replacement still fail before a request. | Three-step control retains original result IDs and final answer; negative hook and inactive-tool cases in the compatibility tests. |
| Keep runtime-defined tool callbacks | The SDK's `dynamicTool` is rejected solely for its `dynamic` type, even with a JSON schema and ordinary local execute callback. localmd uses this constructor for external tools. | Accept runtime-defined callbacks under the same original-ID, schema and whole-batch checks. Input hooks, approval continuations and provider execution remain outside this adapter. | Paired native/guarded continuation preserves IDs and SDK dynamic-call metadata. Invalid-schema, unknown-tool and duplicate-ID siblings all produce zero effects. |
| Preserve provider routing | The wrapper omits native `queryParams` and `includeUsage`; JavaScript settings outside the subset are silently ignored. | Forward routing and usage selection. Reject other unsupported settings explicitly. | An installed-provider test checks the actual outgoing URL and body. |
| Abort while an application callback is pending | The SDK's consumer can settle, but the guard retains the original response-reader lock and delays its decision until a validator or recorder returns. | Cancel the guard's wait, release the reader, revoke authority and emit refusal without waiting for the callback. Late completion cannot grant authority. | The new validator/recorder tests fail against 0.2.0 and pass with the fix, including checks before the callback is released. |
| Understand a saved application-schema failure | Wire-only replay can say `allowed` even though the original application validator refused. That is the documented scope, but the human CLI output leads with the replay status. | Print both the current wire decision and the recorded decision, with the excluded application/SDK checks. JSON scope and explicit wire expectations remain unchanged. | [Recorder tests](../packages/ai-sdk/test/recording.test.mjs) exercise the differing outcomes; [CLI](../packages/ai-sdk/src/cli.ts). |

These are authored, offline reproductions through the installed SDK/provider.
They establish implementation behavior, not how often a production incident
occurs or whether a developer will keep the dependency.

## Comparison with the developer's existing choices

| Task | Native SDK | Core PSJ with caller-owned dispatch | Guarded-chat preview |
| --- | --- | --- | --- |
| Install | Normal SDK/provider dependencies | Published `prefix-safe-json` | Core plus a separate GitHub artifact and supported SDK/provider peers |
| Existing tool callbacks and result continuation | SDK-owned | Application must own dispatch and continuation | SDK-owned ordinary function and runtime-defined callbacks |
| Original wire identity and completion policy before effects | Depends on provider/native behavior | Application retains original evidence and consumes one-shot authority | Original HTTP/SSE response checked before releasing tool bytes |
| Per-step configuration | Broad SDK lifecycle | Application-owned | Checked subset in 0.3; fixed configured model and registered tools |
| Approval, native Responses/Messages, arbitrary provider objects | Available according to the SDK/provider | Requires a matching original-evidence integration | Outside this Chat Completions adapter |
| Logging and diagnostics | Native telemetry and DevTools already exist | Caller-owned | Opt-in local refusal evidence and wire-policy replay |

The [SDK's middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware) is a useful
benchmark for a small integration surface. It operates at the language-model
boundary; wrapping a model after provider parsing cannot recover an original
ID that the provider replaced. The [existing identity comparison](IDENTITY_TRIAL.md)
is the concrete distinction to test, rather than assuming another layer is
needed. The [native DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools)
already provide inspection, so generic logging alone is a weak reason to add
PSJ. Its useful distinction must be a required execution policy or a regression
that the application's native path does not already cover.

## Constraints that remain real

Tool-bearing bytes still wait for EOF and whole-batch validation. Display-only
text can stream, but unknown envelopes cause buffering and already displayed
text is provisional. Relaxing the tool boundary to execute a completed-looking
call before EOF would remove the late-error protection.

Schemas must validate the original JSON without changing it. Defaults,
coercion, stripping and transforms can therefore block migration from a more
permissive application. Input hooks, approval continuation, model/tool
replacement and repair need separate execution contracts; accepting their
option names without enforcing those contracts would be misleading.

The guard provides no rollback, durable cross-run idempotency or protection
for effects inside arbitrary application validators. Callback cancellation is
cooperative: an already running validator or local write may finish after the
guard stops waiting. A saved wire replay cannot serialize and rerun arbitrary
application code, approvals or SDK continuation.

Registry access and publishing are different checks. The public core resolves
normally; this environment's `npm whoami --json` returns E401, and no registry
publication for `psj-ai-sdk` was verified. The core package's existing publish
workflow does not establish a trusted publisher for another package. npm's
[trusted-publisher setup](https://docs.npmjs.com/trusted-publishers/) is configured
per package. The GitHub artifact is a working distribution path, but the short
`npm install psj-ai-sdk` experience remains unresolved.

## What the independent feedback supports

The [Sidecar maintainer](https://github.com/nedonatelli/sidecar/issues/164#issuecomment-6179590817)
declined both the dependency and demo, citing its native Ollama path and
different completion policy. The [harness-kernel maintainer](https://github.com/rarebit-one/harness-kernel/issues/76#issuecomment-6264504755)
published a native termination fix and raw argument metadata. These support
native correction and protocol fit as real alternatives. They do not establish
why other maintainers have not replied.

The [retained Sandbase integration](ADOPTION_PILOTS.md#existing-adopter-maintenance)
shows that PSJ can remain in a maintained application and independent CI.
The new preview still needs a maintainer's own run, a keep/remove decision and
a later independently confirmed use after an actual dependency update or
incident. Operator test counts and artifact downloads cannot supply that proof.

The next product priority is completing ordinary installation and verifying
one supported production integration with the owner. More provider adapters
or another logging platform should follow a concrete blocked workflow, rather
than another authored demonstration alone.
