# psj-ai-sdk

Experimental OpenAI-compatible Chat Completions integration for AI SDK 7.
Keep ordinary `execute` callbacks and let the SDK return their results to the
model. The package reads the original response, checks the entire tool batch,
then releases the unchanged response bytes to the SDK.

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

Distributed separately from the core runtime as a GitHub preview tarball:

```sh
npm install --save-exact https://github.com/canblmz1/prefix-safe-json/releases/download/psj-ai-sdk-v0.1.0/psj-ai-sdk-0.1.0.tgz
```

Install the supported application-owned peers too: `ai`,
`@ai-sdk/openai-compatible` and `prefix-safe-json@0.6.1`. Keep the lockfile.
The release includes checksums. This package is not on the npm registry;
`private: true` prevents accidental registry publication.

The installed-package matrix covers `ai@7.0.29` / provider `3.0.11`,
`ai@7.0.128` / provider `3.0.71`, and `ai@7.0.143` / provider `3.0.71`.
The peer ranges are `ai >=7.0.29 <8` and provider `>=3.0.11 <4`;
unlisted patches are not individually certified.

## What changes

- Each response is buffered completely **before the SDK can execute a tool**.
  This delays the first text/reasoning chunk until that response ends. It is
  appropriate when that latency is acceptable; it is not a transparent
  low-latency streaming replacement.
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

Ordinary local function tools with `execute` are supported. Input lifecycle
hooks, provider-executed tools, approval continuation, `prepareStep`, input
refinement, model replacement and call repair are refused rather than quietly
bypassing the original-response boundary. For those workflows, retain the
[caller-owned integration](../../examples/typed-agent-loop/README.md).
This first adapter does not implement Anthropic Messages or OpenAI Responses.

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

Optional `onDecision(event)` receives only `status`, `toolCalls` and a refusal
reason. `allowed` means a batch was validated, not that its tools ran. Reports
and adoption counting remain application-owned; the package collects none.

## Development

```sh
npm ci --ignore-scripts
npm test
npm pack
```
