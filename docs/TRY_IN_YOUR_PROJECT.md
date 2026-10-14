# Try PSJ in your project

Start with a harmless tool in a development branch. The first useful result is
one complete call that runs once and one interrupted call that does not run.

## Check the published demo

With Node 22+ and npm available, run from this checkout:

```bash
node scripts/try-npm-demo.mjs
```

This installs the pinned published packages in a new temporary directory,
prints the installed versions, and runs the standalone demo. It needs no API
key or repository dependencies. The directory stays available for editing and
rerunning. Installation requires access to the npm registry.

Expected effect counts, in scenario order: **1 / 0 / 0 / 0 / 1**. The third
scenario has complete, schema-valid JSON but ends with a token-limit reason;
the tool must still not run. All SDK callbacks stay at zero, and consuming an
execution decision a second time produces no authority.

The demo uses a mock provider. Running it alone does not establish integration
in your project or compatibility with your live provider.

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
