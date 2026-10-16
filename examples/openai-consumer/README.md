# OpenAI SDK installed-package trial

With Node 22+ and npm, run from the repository checkout:

```bash
node scripts/try-npm-demo.mjs openai
```

The launcher copies this directory to a retained temporary project, installs
published `prefix-safe-json@0.5.4` and official `openai@7.34.0`, prints the
installed versions, and runs the assertions. Alternatively, copy this directory
outside the checkout, run `npm install --engine-strict`, then `npm start`.
No API key or repository development dependencies are needed. The SDK's fetch
transport is replaced completely; there are no live model requests.

The real `chat.completions.create({ stream: true })` parser receives fragmented
SSE bytes. Every unchanged SDK-emitted chunk feeds `OpenAICompatibleStreamAdapter`
and the execution gate. After the SDK iterator drains, the caller feeds
`adapter.finish()` into the gate, calls `gate.finish()`, then consumes authority
once per call. The only dispatched effect is an in-memory counter.

| Authored scenario | Expected effects |
| --- | ---: |
| Complete arguments and `tool_calls` termination | 1 |
| Complete, schema-valid arguments and `length` termination | 0 |
| Incomplete JSON despite `tool_calls` termination | 0 |
| Complete arguments, EOF without a finish reason | 0 |
| Two calls with distinct IDs | 2 |
| Two calls reusing one ID at different tool indexes | 0 |
| Argument delta after the finish reason, before `[DONE]` | 0 |
| Complete JSON and a falsely successful terminal signal | **1: limitation** |

The last row deliberately has the same observable bytes and terminal signal as
the first. A client cannot discover that a server hid an upstream truncation
reason. This models the evidence loss described in
[vLLM #58228](https://github.com/vllm-project/vllm/issues/58228); it is **not** a
run of vLLM, a reproduction of its full server path, or a claim that PSJ fixes
that server bug. Its proposed upstream fix is separate. Malformed JSON is still
refused even when the terminal falsely reports success, as the third row shows.
Token usage at a configured limit alone is not proof that a value was cut off.

For your own project, replace the mock transport with your provider and retain
the original streamed chunks at this boundary. Keep tool dispatch caller-owned;
this recipe does not use an SDK runner that automatically invokes callbacks.
If consuming the stream throws, do not dispatch an unfinished result. Retain
your own permissions, approval checks and semantic validation before any real
side effect. Do not recreate raw chunks from parsed final tool-call objects.

These are selected deterministic client-parser checks, not live OpenAI or
vLLM certification, a production framework integration, or independent adoption.
The SDK can discard bytes after `[DONE]`; PSJ cannot inspect discarded data.
The documented [OpenAI streaming format](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)
defines `length` and `tool_calls` as different termination reasons.

[Report your own-project run or integration blocker](https://github.com/canblmz1/prefix-safe-json/blob/main/docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
