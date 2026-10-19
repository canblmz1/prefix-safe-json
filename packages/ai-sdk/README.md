# psj-ai-sdk

Experimental OpenAI-compatible Chat Completions integration for AI SDK 7.
Keep ordinary `execute` callbacks and let the SDK return their results to the
model. Text and reasoning can stream while the package checks the original
response. Tool calls wait for the entire response and batch validation.

```typescript
import { createGuardedChat } from "psj-ai-sdk";
import { stepCountIs } from "ai";

const chat = createGuardedChat({
  name: "my-provider",
  baseURL: "https://your-provider.example/v1",
  apiKey: process.env.MODEL_API_KEY,
});

const result = chat({
  model: "your-model",
  tools, // your existing function tools, input schemas and execute callbacks
  prompt: "Read the requested records, then summarize them.",
  stopWhen: stepCountIs(5),
});
console.log(await result.text);
```

There is no application-written raw-stream reader, authority dispatch loop,
tool-result message assembly or second model request. The returned object is
the native SDK result, including `fullStream`, `steps` and response helpers.

## Install the preview

For a registry release, install the integration and core dependency. Keep an
existing application's supported locked AI SDK/provider peers:

```sh
npm install --save-exact psj-ai-sdk@0.3.2 prefix-safe-json@0.6.2
```

Keep your application's supported locked `ai` and `@ai-sdk/openai-compatible`
versions. For a **new project**, this single command installs a tested pair:

```sh
npm install --save-exact psj-ai-sdk@0.3.2 prefix-safe-json@0.6.2 ai@7.0.143 @ai-sdk/openai-compatible@3.0.71
```

The published GitHub-only 0.3.0 preview remains available independently of
registry publication, with its original artifact and checksum:

```sh
npm install --save-exact prefix-safe-json@0.6.1 https://github.com/canblmz1/prefix-safe-json/releases/download/psj-ai-sdk-v0.3.0/psj-ai-sdk-0.3.0.tgz
```

The core npm package does not export `createGuardedChat`. Package publication
uses the [separate release workflow](RELEASING.md); a GitHub preview release
does not itself establish that a registry version exists.

Before the candidate versions are published, use the two tested tarballs as
described in the [evaluation kit](../../docs/COMPANION_EVALUATION.md). Older
0.3.0/0.3.1 builds do not include the whole-batch diagnostic fix in 0.3.2.

## Whole-response batch policy

All tracked calls must be executable, and the core coordinator must report no
`error` or `fatal` diagnostic for the original response. This includes calls
that exceeded the default 128-call limit or were dropped for an invalid index:
they have no entry in the core's per-call decisions, but still refuse the
companion's entire group. Original nonempty IDs are required before application
validation or one-shot authority consumption. Warning/info diagnostics and
supported provider extension fields do not refuse a healthy group.

127 and 128 valid calls remain supported. At 129 calls, neither a valid nor an
invalid final call permits any callback or continuation. This policy validates
the group before execution; it does not roll back callbacks after they begin.
See the [contract and regression evidence](../../docs/BATCH_CONTRACT.md).

The installed-package matrix covers `ai@7.0.29` / provider `3.0.11`,
`ai@7.0.128` / provider `3.0.71`, and `ai@7.0.143` / provider `3.0.71`.
The peer ranges are `ai >=7.0.29 <8` and provider `>=3.0.11 <4`;
unlisted patches are not individually certified.

## What changes

- Display-only text/reasoning frames stream before EOF by default. The first
  tool-bearing, terminal, control or unknown frame **and every subsequent
  byte** wait for EOF and whole-batch validation. Mixed text/tool frames wait
  too; original bytes and order are preserved. Unrecognized provider fields
  can cause buffering. `textStreaming: "buffered"` retains the 0.1.0 behavior.
- Displayed text is provisional. A later refusal can terminate the native
  response body after text has appeared; handle errors when consuming the
  stream as well as `onError`. Displayed text never authorizes a tool. This
  feature is not verification of generated prose or a latency guarantee.
- The buffer defaults to 8 MiB per physical response. `maxResponseBytes` can
  select 1 byte to 64 MiB. Oversized, interrupted or invalid UTF-8 responses
  are refused before any call from that response is released.
- Original wire completion, identity and schema checks run before SDK parsing.
  A duplicate wire ID cannot gain authority under an SDK-generated replacement.
- All original application input validators run once for the entire batch.
  Outputs must equal the raw JSON: coercion, defaults, stripped keys and
  transforms are refused. The SDK then validates against those approved
  values, and each `execute` checks its exact name, ID and value once.
- Network retries are disabled. Native SDK tool-result serialization and
  `stopWhen` continuation are retained. A tool error can become a normal SDK
  error result; application effects are not transactional or rolled back.
- Provider keys, headers and raw arguments are not included in guard events.
  Nothing is transmitted to the package maintainer.

Ordinary local function tools and SDK `dynamicTool` definitions with `execute`
are supported. Runtime-defined tools use the same schema, original-ID and
whole-batch checks; the SDK retains their dynamic-call metadata. Input lifecycle
hooks, provider-executed tools, approval continuation, input
refinement, model replacement and call repair are refused rather than quietly
bypassing the original-response boundary. For those workflows, retain the
[caller-owned integration](../../examples/typed-agent-loop/README.md).
This first adapter does not implement Anthropic Messages or OpenAI Responses.

## Keep step selection and ordinary SDK settings

`instructions`, `system`, `reasoning`, sampling controls, `providerOptions`,
`onStepFinish`, and `prepareStep` can remain in a supported SDK call:

```typescript
const result = chat({
  model: "your-model", tools, prompt, instructions: "Be concise.",
  reasoning: "none", stopWhen: stepCountIs(5),
  prepareStep: ({ messages, stepNumber }) => ({
    messages,
    activeTools: stepNumber === 0 ? ["search"] : ["summarize"],
  }),
});
```

The selected names must be tools registered in `tools`. The hook can return
`activeTools`, `toolChoice`, `messages`, `instructions`/`system`, `providerOptions`
and sampling controls, or `undefined`. Every physical request is checked against
its actual outgoing tools, so an inactive tool cannot gain authority. Returning
a replacement model, tool set, execution context, sandbox or unknown field fails
before the next provider request. Provider metadata cannot change the configured
wire model. Input schemas and callbacks stay registered for the invocation.

Provider settings accept `name`, `baseURL`, `apiKey`, `headers`, `queryParams`,
`includeUsage` and `fetch`, alongside the guard settings above. Unsupported
settings produce an explicit configuration error instead of being silently
discarded. This is still a subset of the native provider/SDK API; compare your
configuration before replacing a broader integration.

On abort/cancellation the guard releases the response reader and revokes
authority without waiting for a pending application validator or recorder.
JavaScript callbacks already in progress may still finish, including a local
file write; their late settlement cannot restore tool authority. Keep validators
free of application effects. `allowed` capture metadata describes validation,
not execution or a guarantee that the invocation was not later cancelled.

## Use it in existing CI

Run the same application test before and after updating the frozen SDK lockfile.
Supply a fixed response through `fetch`; it replaces the provider transport,
so no model or API key is needed:

```typescript
const chat = createGuardedChat({
  name: "ci",
  baseURL: "https://fixture.invalid/v1",
  fetch: async () => new Response(savedSseBytes, {
    headers: { "content-type": "text/event-stream" },
  }),
});
```

A complete control must include a following text response and verify the
outgoing tool-result IDs. Also keep the relevant refusal case and assert zero
callbacks. The [integration tests](test/integration.test.mjs) exercise the
actual installed SDK/provider parser, sequential execution and concurrent runs.
They are authored tests, not production-incident or independent-user evidence.

For already-saved captures, use the separate
[offline regression CLI](../regression/README.md).

## Record a failure and replay its wire policy

Opt into local recording with one setting; no manual stream reader is needed:

```typescript
import { createFileRecorder } from "psj-ai-sdk/recording";

const chat = createGuardedChat({
  name: "my-provider", baseURL, apiKey,
  onCapture: createFileRecorder({
    directory: ".psj/captures",
    onSaved: path => console.log("Saved response:", path),
  }),
});
```

The default records only refused successful-HTTP SSE responses. `mode: "all"`
also retains allowed responses, useful for a positive control. Each response
gets a separate directory with exact `response.sse` bytes and `recording.json`:
SHA-256, byte length, wire tool schemas, whether EOF was observed, and the
original batch decision. Interrupted and size-limited bodies are explicitly
incomplete; recording respects `maxResponseBytes`. Request prompts, headers,
keys and tool results are not captured. Response text, arguments and schema
descriptions can contain sensitive data: keep the directory local and add
`.psj/` to your application's `.gitignore`. Retention/deletion is caller-owned.
Recording is off unless `onCapture` is supplied, and nothing is uploaded.

```sh
npx --no-install psj-chat replay .psj/captures/response-XXXXXX/recording.json --json
# An explicit status expectation can fail CI (exit 1 on mismatch):
npx --no-install psj-chat replay path/to/recording.json --expect refused --json
```

```typescript
import { replayRecording } from "psj-ai-sdk/recording";
import assert from "node:assert/strict";
const report = await replayRecording("path/to/recording.json");
assert.equal(report.replayed.status, "refused");
assert.equal(report.replayed.reason, "stream_incomplete"); // choose your reviewed reason
```

Replay checks the saved hash and current PSJ wire policy without a key,
network, SDK execution or application tools. Incomplete captures always refuse.
Reports omit bodies, arguments and schema content. `allowed` means wire-eligible;
custom application validators, transforms, execution and SDK continuation are
outside this replay. For example, a recorded `application_schema_invalid` can
be wire-eligible on replay. To test the actual SDK and continuation, use the
separate regression CLI with reviewed harmless stubs and a positive control.
Replay does not generate or approve CI expectations automatically.

`onCapture` also accepts your own async local writer. It receives a detached
`GuardCapture`; changing it cannot change approved inputs. Recording completes
before tool authority is installed. If it fails for an otherwise allowed
batch, that batch refuses with `recording_error`; a refusal remains refused
even if recording fails. `allowed` in a recording describes validation, never
proof that tools ran. Consume/cancel the native stream so requests can settle.
The file recorder and replay entry point require Node; the main import does
not import filesystem code. Non-2xx HTTP responses and unsupported content
types are outside this recorder's scope.

Optional `onDecision(event)` receives only `status`, `toolCalls` and a refusal
reason. `allowed` means a batch was validated, not that its tools ran. Reports
and adoption counting remain application-owned; the package collects none.

## Development

```sh
npm ci --ignore-scripts
npm test
npm pack
```
