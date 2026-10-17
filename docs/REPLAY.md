# Turn a tool-stream incident into a regression test

When a streamed tool call is skipped or unexpectedly reaches an execution
boundary, keep its original events and replay them locally. The repository's
development CLI explains PSJ's decision and can check an explicit expected
outcome in CI. It never dispatches tools or requests a model.

This is an experimental development workflow, available from a repository
checkout with Node 22+ and the development dependencies installed. It is not
an installed npm command or a new runtime API.

For SDK-upgrade checks, the separate [regression companion](../packages/regression/README.md)
passes saved HTTP/SSE bodies through the installed AI SDK and provider before
checking tool inputs and continuation. This replay CLI checks recorded
decoded events instead; it does not exercise an upgraded SDK's parser.
The companion is a private, unpublished prototype with its own package and
tests, not a new command shipped in the PSJ runtime tarball.

## Try the missing-terminal incident

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec tsx scripts/replay-tool-stream.ts --provider anthropic --input examples/replay/anthropic-missing-stop.jsonl --schemas examples/replay/schemas.json --expect examples/replay/expect-missing-stop.json
```

The synthetic example contains complete, schema-valid arguments and a
`stop_reason`, but no final `message_stop`. The result is `retry` /
`stream_incomplete`. Its expectation passes because withholding execution is
the desired behavior. Changing that expectation to `execute` / `complete`
makes the command exit with status 1.

## Capture your own incident

Write one **original decoded event** per JSON line, in arrival order. Choose
`--provider anthropic` for one Messages response's native Anthropic events,
or `--provider ai-sdk` for one invocation's original `fullStream` parts.
Do not mix responses in one file. AI SDK parts may include multiple steps
and interleaved tool calls; the replay uses the execution guard to preserve
that lifecycle boundary.

For example, in a local development harness, a recorder can wrap the same
stream your application already consumes:

```javascript
import { open } from "node:fs/promises";

const file = await open("incident.jsonl", "wx", 0o600);
try {
  for await (const part of result.fullStream) {
    await file.writeFile(JSON.stringify(part) + "\n");
    guard.push(part);
  }
} finally {
  await file.close();
}
```

Here `result` and `guard` belong to your existing application. This illustrative
recorder is opt-in local debugging code; recording adds I/O latency. JSONL is
not a lossless serialization for non-JSON objects such as `Error` instances.
Keep any such failures separately and inspect capture fidelity before using a
trace as regression evidence. No recorder is automatically installed.

These files can contain confidential arguments, text, identifiers, and error
data. Keep originals local and out of source control. Use reviewed synthetic
reproductions for public fixtures. This tool does not redact input files.
Raw SSE bytes, repaired JSON, and already-parsed tool argument objects are
different boundaries; do not fabricate original deltas or terminal events
from those representations.

## Set the expected behavior

Review the report, then write an expectation file deliberately:

```json
{
  "formatVersion": 1,
  "calls": [
    { "name": "record", "action": "retry", "reason": "stream_incomplete" }
  ]
}
```

Call count and order must match exactly. Every entry requires `action` and
`reason`; optional `name` and `toolCallId` are also compared when supplied.
Use stable synthetic identifiers when checking IDs across runs. Never
automatically accept a report as its own expected behavior.

An optional `--schemas` file maps tool names to PSJ-supported JSON Schemas,
as shown in [`examples/replay/schemas.json`](../examples/replay/schemas.json).
Without it, replay makes no schema-validation claim. Custom validators and
application permission checks are outside this CLI.

## Run it in CI

After installing development dependencies in a repository checkout, run the
same command with your reviewed trace and `--expect`. Add `--json` to obtain
a versioned machine-readable report:

```bash
pnpm exec tsx scripts/replay-tool-stream.ts --provider ai-sdk --input incident.jsonl --expect expected.json --json
```

| Exit status | Meaning |
| --- | --- |
| 0 | Report generated, or supplied expectations matched |
| 1 | At least one expectation did not match |
| 2 | Invalid input, configuration, or replay failure |

Without `--expect`, status 0 is diagnostic success; it does not assert that
calls can execute. Empty traces and traces with no recognized tool calls
exit with status 2, so a wrong capture boundary cannot silently pass a test.

Reports contain actions, reason codes, completion evidence, and diagnostic
codes. They omit argument values, raw provider-reason strings, and diagnostic
messages. Tool names and call IDs remain; review them before sharing reports.
Inputs must be valid UTF-8. A trace is limited to 16 MiB and 100000 events;
schema and expectation files are each limited to 1 MiB.

## What replay establishes

All recorded events are consumed before decisions are reported, including
contradictory evidence after an apparent terminal event. `execute` means
that the **recorded evidence** satisfies PSJ's gate. It does not dispatch a
tool, grant application permission, or prove the original application used
PSJ at its real execution boundary.

Replaying an old SDK-emitted trace does not exercise a newly upgraded SDK's
parser. To investigate an SDK change, capture fresh events through that
version in your actual harness, then replay and compare. This CLI makes no
live-provider or complete SDK-compatibility claim.

`sdk_execution_observed` includes conservative withholding after a
`tool-error`; that event can be emitted for invalid input before execution.
Do not read the reason name as proof that a tool ran. See the
[external fit audit](EXTERNAL_FIT_AUDIT.md) for the real-SDK counterexample
and for cases where the existing SDK/application behavior already suffices.

The product hypothesis is a recurring incident-to-regression workflow:
diagnose one failure, preserve its expected outcome, and keep checking it as
the application changes. Demand for this workflow is not yet established;
the next useful evidence is a developer applying it to an incident from
their own project.
