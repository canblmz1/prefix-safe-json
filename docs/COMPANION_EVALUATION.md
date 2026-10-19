# Evaluate the companion in an application

This is an evaluation kit for a maintainer whose application uses AI SDK 7,
the OpenAI-compatible provider, Chat Completions SSE and ordinary local
`execute` callbacks. It tests the policy before execution: original argument
bytes, original IDs, complete response, schema and the whole response's call
group. The SDK still owns execution, results and continuation.

## Install and reproduce

Node 22+ is required. Follow the [package installation instructions](../packages/ai-sdk/README.md)
for the available release and preserve your application's supported locked
SDK/provider pair. For a review before registry publication, install the two
prepared artifacts in a new directory:

```sh
npm init -y
npm install --save-exact ./prefix-safe-json-0.6.2.tgz ./psj-ai-sdk-0.3.2.tgz ai@7.0.143 @ai-sdk/openai-compatible@3.0.71 zod@4.4.3
```

Copy [comparison.mjs](../examples/guarded-chat/comparison.mjs) into that
directory, then run:

```sh
node comparison.mjs
```

The script imports public installed packages only. It prints actual installed
versions and JSON rows containing callback inputs/IDs, request counts,
tool-result IDs/content, reasons and the final answer. It makes no external
model request. A passing run finishes with `{"kind":"summary","cases":21,"status":"PASS",...}`.

All three paths receive the same authored HTTP/SSE response, schema, callbacks,
model settings and follow-up text response:

1. Native `streamText` and the installed provider.
2. A small application-native middleware that buffers the provider's normalized
   model parts, checks every JSON input/schema and emitted ID, then releases the
   group only after a successful finish. It uses no PSJ code.
3. The companion checking the original response before the provider parses it.

The native middleware is an inspectable alternative for this fixed schema,
not a production adapter. It buffers all output, has a 1,024-part ceiling and
does not implement approvals, dynamic tool selection or retry policies. A
production implementation would need to maintain those requirements.

## Observed behavior on the pinned SDK/provider pair

The comparison asserts these callback counts on `ai@7.0.143` and
`@ai-sdk/openai-compatible@3.0.71`:

| Authored response | Native | Small native check | Companion |
| --- | ---: | ---: | ---: |
| Two valid calls with distinct IDs | 2 | 2 | 2 |
| Duplicate `message` member in one argument object | 2 | 2 | 0 |
| Two calls sharing an original wire ID | 2 | 2 | 0 |
| One schema-invalid sibling | 1 | 0 | 0 |
| One malformed JSON sibling | 1 | 0 | 0 |
| Complete JSON but `length` finish | 0 | 0 | 0 |
| Missing finish reason | 0 | 0 | 0 |

The healthy control checks both original IDs in the callbacks and second
request, paired tool-result contents and the final answer. Each refused
companion/native-check group has no callback, no released tool-call/result
part and no continuation request.

The native path already validates JSON/schema per call. For an invalid sibling
it executes the valid call and continues with that result plus the invalid
call's error result. The current native finish checks already prevent effects
for `length` and missing finish; these cases show no extra PSJ execution
benefit.

In the duplicate-member fixture, native JSON parsing keeps the last `message`
value. In the duplicate-ID fixture, the provider retains the first ID and
generates a different ID for the other call. The small middleware sees unique
normalized IDs, so its uniqueness check passes. The companion instead refuses
the original ambiguity. The duplicate-member case reports `malformed`, the
duplicate original ID reports `protocol_violation`, and the schema-invalid
sibling reports `schema_invalid`. The unfinished JSON sibling reports
`truncated`; both finish-reason cases report `stream_incomplete`.

These are reproducible policy differences, not evidence that these responses
occur often in real traffic or that every application wants the stricter
policy. A custom native check with its own original-byte parser could enforce
more of the same rules. Compare its maintenance cost with this dependency.

## Add it to a development branch

Keep the existing supported schemas, callbacks and continuation condition:

```typescript
import { createGuardedChat } from "psj-ai-sdk";
import { stepCountIs } from "ai";

const chat = createGuardedChat({ name: "my-provider", baseURL, apiKey });
const result = chat({
  model: modelId,
  tools,
  messages,
  stopWhen: stepCountIs(5),
  onError: ({ error }) => reportError(error),
});
await result.consumeStream();
```

Use the healthy case and one refusal that matters to the application with
its real tool definitions and installed SDK/provider versions. Start with an
in-memory callback so the test can count effects directly. Assert original
IDs, tool-result pairing, a final answer and zero callbacks/continuation for
the refusal. Add the application test beside existing tests; the fixture
transport in `comparison.mjs` replaces the HTTP response only.

Integration costs and current limits:

- Every tool-bearing response waits for EOF and the whole group's validation.
  A display-only text/reasoning prefix can stream; displayed text is provisional.
- The default response ceiling is 8 MiB and the default core call limit is 128.
  Exceeding the call limit refuses the entire companion group.
- Application validators run before effects and must preserve original JSON.
  Coercion, defaults, transforms and stripped keys are refused.
- Ordinary function and `dynamicTool` callbacks, supported generation settings
  and limited `prepareStep`/`activeTools` selection are supported. Input hooks,
  approval continuation, call repair and replacement models/tools/contexts are
  outside this adapter. See the package's exact supported subset.
- This adapter covers Chat Completions SSE through the named provider. It does
  not cover native Responses or Messages protocols. Network retries are disabled.
- A validated group is not a transaction. A later callback can fail after an
  earlier callback has changed application state. This package does not provide
  authorization, sandboxing, prompt injection protection, distributed exactly-once
  execution or rollback of completed effects.

## Decide whether to keep it

Ask the independent maintainer to record:

1. Which application commit, provider/model and exact package versions ran?
2. Do its own healthy tools still execute and reach a correct final answer?
3. Which refusal policy is actually required by that application? Would its
   current native behavior or a small local check already meet that need?
4. What broke or became more costly: unsupported options, latency, buffering,
   schemas or error handling?
5. Keep or remove the dependency, and why? If kept, which application test or
   operational requirement will justify it after the initial trial?

Record a later independent application run or maintained integration before
calling this recurring use. Our fixture results, clean consumer, fork CI,
evaluation PR and downloads do not establish that outcome. Historical core
usage is separate from adoption of this companion version; the
[adoption notes](ADOPTION_PILOTS.md) preserve that distinction.
