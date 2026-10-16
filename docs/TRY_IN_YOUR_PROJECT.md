# Try PSJ in your project

Start with a harmless tool in a development branch. The first useful result is
one complete call that runs once and one interrupted call that does not run.

## Check the published demo

Without a checkout, download the
[six-SDK trial ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.5.4/prefix-safe-json-0.5.4-trials.zip)
and extract it. From the extracted directory, run
`node scripts/try-npm-demo.mjs tanstack`, or choose `ai-sdk`, `openai`,
`anthropic`, `langchain` or `openrouter`. Every example installs published
PSJ `0.5.4`. The ZIP contains example sources, the launcher and licenses;
it downloads the package and SDK dependencies from npm and needs no API key.
The earlier dated trial downloads remain unchanged.

With Node 22+ and npm available, run from this checkout:

```bash
node scripts/try-npm-demo.mjs
```

This installs the pinned published packages in a new temporary directory,
prints the installed versions, and runs the standalone demo. It needs no API
key or repository dependencies. The directory stays available for editing and
rerunning. Installation requires access to the npm registry.

For the official Anthropic SDK, run `node scripts/try-npm-demo.mjs anthropic`.
The [Anthropic consumer trial](../examples/anthropic-consumer/README.md) checks
effects **1 / 0 / 0 / 0 / 0**, including complete JSON at a token limit and EOF
after stop-reason metadata but before `message_stop`. For the installed
LangChain comparison, run `node scripts/try-npm-demo.mjs langchain`.

For OpenAI Chat Completions or a compatible endpoint, run
`node scripts/try-npm-demo.mjs openai`. The
[OpenAI consumer trial](../examples/openai-consumer/README.md) checks termination,
identity and late argument evidence through the installed official SDK. It also
demonstrates a limit: complete JSON plus a falsely successful server terminal
still grants authority; PSJ cannot reconstruct the hidden upstream stop reason.

Expected effect counts, in scenario order: **1 / 0 / 0 / 0 / 1**. The third
scenario has complete, schema-valid JSON but ends with a token-limit reason;
the tool must still not run. All SDK callbacks stay at zero, and consuming an
execution decision a second time produces no authority.

The AI SDK launcher then runs the interleaved batch check: effects **2 / 0**
for two complete calls and for a token-limited step containing a complete call
plus a truncated call. A completed call inside that interrupted step must not
run. You can rerun that comparison with `npm run batch` in the retained
temporary project. Application retry policy and UI state remain caller-owned.

The demo uses a mock provider. Running it alone does not establish integration
in your project or compatibility with your live provider.

The launcher also runs `npm run identity`: native / PSJ effect counts are
**2 / 2** for two distinct IDs and **2 / 0** for two complete calls sharing
an ID. Unlike the locked cases, its native control intentionally executes
harmless counters. The [identity trial](IDENTITY_TRIAL.md) explains when this
demonstrates an additional check and when your provider already resolves IDs.

## Connect your existing AI SDK stream

Use the [README's safe execution example](../README.md#safe-execution-example)
with your own model, prompt, and a harmless tool. Keep the same schema in the
tool definition and guard validator. Pass the locked tools to `streamText()`;
feed every `fullStream` part to the guard, drain the stream, then dispatch only
from `takeDecision().value` when authority is present.

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
