# Try PSJ in your project

Start with a harmless tool in a development branch. The first useful result is
one complete call that runs once and one interrupted call that does not run.

## Keep ordinary AI SDK callbacks

For AI SDK 7 and OpenAI-compatible Chat Completions, use the separate
[guarded chat preview](../packages/ai-sdk/README.md). Keep your function tools'
normal `execute` callbacks. The integration retains the raw response and the
SDK owns tool results and continuation:

```typescript
const chat = createGuardedChat({ name: "provider", baseURL, apiKey });
const result = chat({ model: modelId, tools, prompt, stopWhen: stepCountIs(5) });
```

Text/reasoning can stream before EOF; tool calls and every subsequent byte
wait for the complete response and batch validation. Displayed text is
provisional. The adapter accepts ordinary function tools without input hooks
or approval continuation; it refuses model replacement and call repair.
Check its supported policies before choosing it. Applications needing the
broader SDK lifecycle can retain the caller-owned path below.

Add `onCapture: createFileRecorder({ directory: ".psj/captures" })` to keep
refused responses locally, then run `psj-chat replay recording.json --json`
without a model key. See the preview's recording import, privacy and replay scope.

## Check whether the caller-owned boundary fits

Before installing, check three things:

1. Can you read original argument deltas and the provider's final completion
   reason? A parsed tool-call object alone is insufficient.
2. Can you prevent the SDK or framework from running the tool before your
   application has checked the stream? A guard added after dispatch is too late.
3. Does your application need a check beyond its current native behavior?
   Run the failure you care about through that behavior first.

If the original events or a pre-execution hook are unavailable, use the
framework's native fix or first add that hook. Do not reconstruct raw
argument evidence by serializing an already parsed object. If the native
behavior already meets your needs, PSJ may add no value for that case.

## Run the complete published example

With Node 22+ and npm, run from a current checkout:

```bash
node scripts/try-npm-demo.mjs
```

The default `guarded` choice creates a separate temporary directory and installs
the separate integration preview, published PSJ `0.6.1`, AI SDK `7.0.143`,
OpenAI-compatible provider `3.0.71` and Zod `4.4.3`. No repository development
dependencies, API key or model server are required. Registry and GitHub release
access are needed; the directory is retained for editing.

It checks complete paired continuation, duplicate wire IDs, output-limit
termination and an invalid sibling. Ordinary SDK callbacks stay in place;
the three refused batches produce no effects or continuation.

Pass `typed` explicitly for the caller-owned loop and its five cases below.

Without a checkout, download and extract the
[0.6.1 TypeScript loop ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.6.1/prefix-safe-json-0.6.1-typed-loop.zip),
then run `npm install --engine-strict --no-audit --no-fund` and `npm start`.
The [example README](../examples/typed-agent-loop/README.md) explains its policy.

| Authored scenario | Expected result |
| --- | --- |
| Complete input and distinct IDs | Two authorized effects, paired results in the second model request, final answer |
| Complete JSON with token-limit termination | Zero effects and no continuation request |
| Duplicate call IDs | Zero effects and no continuation request |
| Cancelled before generation | Zero model requests and zero effects |
| First tool throws | One attempted effect; no automatic retry or continuation |

These fixtures verify the full caller-owned loop. They do not establish
integration in your application or compatibility with your live provider.

## Compare another SDK

Pass `ai-sdk`, `openai`, `anthropic`, `langchain`, `openrouter` or
`tanstack` to the launcher for an SDK-specific trial. Those six earlier
trials retain published PSJ `0.5.4`; exact SDK versions and limitations are
listed in the [trial index](../examples/README.md).

For example, `node scripts/try-npm-demo.mjs ai-sdk` runs the original five
single-step checks, the interleaved batch check, and a native/PSJ identity
comparison. Distinct IDs have native/PSJ effect counts **2 / 2**; duplicate
IDs have **2 / 0**. The [identity trial](IDENTITY_TRIAL.md) explains the
original-event boundary. Native behavior that already refuses token limits
is useful independently of PSJ.

The [six-SDK ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip)
retains its original launcher and six choices. It does not include the newer
`typed` trial. Earlier dated downloads keep their original sources and pins.

## Connect an existing caller-owned AI SDK stream

Use the [README's safe execution example](../README.md#safe-execution-example)
with your own model, prompt, and a harmless tool. Keep the same schema in the
tool definition and guard validator. Pass the locked tools to `streamText()`;
feed every `fullStream` part to the guard, drain the stream, then dispatch only
from `takeDecision().value` when authority is present.

This changes the execution flow: move the tool's effect out of SDK callbacks,
consume authority after the stream ends, then send each accepted result with
its original `toolCallId` into your application's next model request. Merely
locking callbacks and draining the stream does not continue an agent.
Copy the [complete loop](../examples/typed-agent-loop/demo.mts) if you need
that continuation; the README's shorter example handles one stream only.

The example requires every call in a batch to have authority before starting
effects. That is a caller policy, not a rollback transaction. Keep your own
timeout, cancellation, retry, persistence and result-serialization policies.
The typed guard accepts synchronous Standard Schema validators that preserve
the original JSON structure; transforms, inserted defaults and removed keys
are refused. Strict Zod objects are a suitable starting point.

Replace the example's file write with an in-memory counter for the first test.
Do not attach your real side effect to the SDK's `execute` or input callbacks.
If your application already executes tools inside a framework, first find a
way to disable that execution and retain the raw stream. Adding the guard
after a tool has run cannot protect that side effect.

Check these cases at that boundary:

| Case | Expected caller-owned effects |
| --- | --- |
| Complete input, valid schema, confirmed termination | One after consuming authority |
| Token-limit termination, even with parseable JSON | Zero |
| Invalid raw arguments with a plausible SDK projection | Zero |
| Second `takeDecision()` for the same call | Zero additional effects |

For other providers, use `createToolCallExecutionGate()` with the matching
adapter and original provider events. See the
[compatibility matrix](COMPATIBILITY.md) before choosing a boundary. Parsed
LangChain messages or reconstructed SDK projections cannot substitute for raw
argument evidence. The [LangChain consumer comparison](../examples/langchain-consumer/README.md)
runs the installed `ChatOpenAI.stream()` against the same raw fixture envelopes
as PSJ; it demonstrates the boundary without providing a production LangChain
adapter. A real application must preserve its own raw provider evidence. There
is no dedicated Pi integration recipe verified by this repository.

## Report a result or request help

[Open an integration report](https://github.com/canblmz1/prefix-safe-json/issues/new?template=integration.yml).
Include your exact installed versions, stream boundary, and the outcome of
the harmless-tool test. A private project description and redacted result are
welcome; a public integration commit or test makes the result independently
checkable. If you could only run the standalone demo, select that stage.

An installation failure or framework blocker is useful feedback too. Report
the first point where you could not preserve raw evidence or stop automatic
execution; it helps identify the next concrete compatibility improvement.
