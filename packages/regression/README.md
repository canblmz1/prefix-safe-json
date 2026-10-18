# psj-regression

An experimental **development-only companion** to prefix-safe-json. It sends
saved raw HTTP/SSE response bytes through your installed AI SDK and provider,
records harmless counter executions, and checks a reviewed expectation file.
It makes no model requests and invokes no application tools.

Version 0.1.0 is an experimental preview distributed as a
[GitHub release tarball](https://github.com/canblmz1/prefix-safe-json/releases/tag/psj-regression-v0.1.0).
It is not published on the npm registry or part of the PSJ 0.6.1 runtime
tarball. Node 22+ is required. The first protocol is OpenAI-compatible
Chat Completions SSE with AI SDK 7 and `@ai-sdk/openai-compatible` 3.

## What it checks

- Actual tool inputs reaching the installed SDK's `execute` callback.
- Execution count and call identities, including index-only interleaved deltas.
- Tool-result IDs present in the next outgoing request.
- Number of model steps, final answer and SDK error count.
- PSJ's decisions from the original wire evidence, including an explanation
  and structural/completion evidence.

The native profile uses the SDK's own multi-step loop with memory-only stubs.
The guarded profile uses locked tools, original-wire PSJ decisions and a
caller-owned whole-batch policy. It withholds the batch on an SDK error and
does not automatically continue a refused batch. These are distinct policies;
a difference is not automatically an SDK defect.

Replaying only old decoded SDK events cannot exercise an upgraded SDK parser.
This harness instead passes the same transport bytes through the installed
`@ai-sdk/openai-compatible` SSE parser and `ai.streamText()` on every run.

## Install the preview

In an AI SDK 7 application with the supported peers installed:

```bash
npm install --save-dev --save-exact https://github.com/canblmz1/prefix-safe-json/releases/download/psj-regression-v0.1.0/psj-regression-0.1.0.tgz
npm exec --offline -- psj-regression doctor --json
npm exec --offline -- psj-regression init --out ./tool-regression
npm exec --offline -- psj-regression check ./tool-regression/suite.json --expect ./tool-regression/expected.json
```

The release includes `SHA256SUMS` for independent download verification.
Commit the application lockfile so the tarball integrity and peer versions
remain pinned. `private: true` prevents accidental npm publication; it does
not prevent installing this development dependency from the release URL.

## Build from source

From this directory:

```bash
npm ci --ignore-scripts
npm test
node dist/cli.js doctor --json
node dist/cli.js check fixtures/suite.json --expect fixtures/expected.json
npm pack
```

To try the actual tarball in your application, install the tarball as a dev
dependency alongside your pinned SDK and PSJ versions. Use the real path to
the newly packed file; no registry package by this name is claimed:

```bash
npm install --save-dev /absolute/path/to/psj-regression-0.1.0.tgz
npm exec --offline -- psj-regression doctor --json
npm exec --offline -- psj-regression init --out ./tool-regression
npm exec --offline -- psj-regression check ./tool-regression/suite.json --expect ./tool-regression/expected.json
```

Peers are `ai >=7.0.77 <8`, `@ai-sdk/openai-compatible >=3 <4` and
`prefix-safe-json >=0.6.1 <0.7`. Keep these application-owned versions pinned
and review the versions printed by `doctor`. The development lockfile uses
AI SDK 7.0.143, provider 3.0.71 and published PSJ 0.6.1. CI also installs the
core candidate tarball. The companion has a separate GitHub preview release.

## A small incident-to-regression workflow

1. Run the authored example as a positive control before adding your incident.
2. Save each original **UTF-8 HTTP/SSE response body** as one local `.sse` file.
   Preserve arrival order and partial termination. Do not serialize a parsed
   argument object or `fullStream` event to manufacture a raw HTTP response.
3. Edit `suite.json`: register the relevant schemas and harmless fixed JSON
   tool results; add response files in the order physical model requests
   should receive them. Mark your own incident `recorded` with a provenance
   note. Keep complete authored controls labelled `authored`.
4. Use `inspect` to validate files, then `run` to understand current behavior.
   Review the incident and write the expected behavior deliberately.
5. Commit only reviewed synthetic or appropriately redacted data. Run `check`
   in CI before and after changing the SDK or provider lockfile.

`init` adds `.gitattributes` so Git preserves captured line endings and bytes
across checkouts. The SSE-specific rule also permits the trailing blank lines
that terminate events. Keep it when adding your own capture files.

Raw files and expectation inputs can contain private arguments or text. Keep
original incident data local. The tool does not redact captures. Reports omit
argument values and final answer text, but contain hashes, IDs, tool names and
provenance notes. SDK error messages are not printed by the harness.

If you already capture provider responses, export those exact response bytes.
Capture fidelity, buffering, timing, interrupted reads and transport errors
must be reviewed separately. This first prototype accepts saved finite SSE
bodies; it does not capture traffic or simulate HTTP status failures, delayed
transport errors, cancellation timing or arbitrary SDK providers.

## Commands and output

| Command | Operation |
| --- | --- |
| `doctor --json` | Peer versions and offline setup status; no auth is required |
| `init --out PATH --dry-run` | Preview copying the authored example |
| `init --out PATH` | Copy fixture files into a new directory; existing directories are refused |
| `inspect suite.json` | Validate the suite and local file references; print names and response hashes |
| `run suite.json --json` | Produce a diagnostic report without declaring expectations passed |
| `check suite.json --expect expected.json --json` | Compare all reviewed cases and emit a CI verdict |

Under `--json`, successful commands emit one JSON object on stdout. Errors
emit `{ "formatVersion": 1, "status": "error", "error": { "code", "message" } }`
on stderr. Native SDK error bodies are not forwarded. `run`/`check` reports
have `scope: "offline-sdk-regression"`, exact installed versions, response
hashes, both profiles and field-level mismatch locations.

Exit **0** means diagnostic success or matched expectations; **1** means
expectation mismatch; **2** means invalid setup, input or unsupported capture.
`run` has `expectations.pass: null`: its exit 0 does not claim the behavior is
correct. `check` requires a nonempty explicit expectation file and an expected
successful positive control with effects, paired results and a final answer.
There is no auto-accept, snapshot-update or baseline-generation command.

Example mismatch location: `complete.native.executions[0].input`. Input
values are compared locally before hashing; they are not echoed in a report.
Object-key order is ignored; array order and numeric/string differences matter.

## Identity checks and reproducibility

Provider IDs are retained literally. An ID assigned by the SDK that is absent
from the original wire data is displayed as `{ "sdkAssigned": 1 }`, then 2,
and so on. The same label in a result means the **actual unmodified SDK ID**
matched the earlier execution ID. This removes random-ID noise without
changing data sent to the SDK or granting authority under an invented ID.

The authored duplicate-ID example currently observes the provider assigning
a new ID and native execution running twice; the raw-evidence guarded policy
refuses both calls. `expected.json` records those distinct reviewed behaviors.
Matching this baseline is not certification that every native behavior is
suitable for your application. To require native refusal, explicitly review
and change that expectation; the current fixture will then fail until the
installed path implements that policy.

## Add to an existing test runner

```typescript
import { runRegression } from "psj-regression";

const report = await runRegression({
  fixture: "tool-regression/suite.json",
  expect: "tool-regression/expected.json",
});
if (!report.expectations.pass) {
  throw new Error(JSON.stringify(report.expectations.mismatches));
}
```

No Vitest dependency is introduced. The same API can be used from Node's test
runner or a project's existing test framework. Keep application-specific
execution, authorization, persistence and retry tests in that project too.

## CI and scope

After installing the application's frozen lockfile:

```bash
npm exec --offline -- psj-regression check tool-regression/suite.json --expect tool-regression/expected.json --json
```

Each suite must include at least one `positiveControl: true` case with a
complete call and a following final response. Data is bounded to 32 cases,
32 tool stubs, eight responses per case, 1 MiB JSON manifests and 8 MiB per
response/32 MiB total. Response paths must remain inside the suite directory.

This is an offline SDK-boundary check. It does not certify a live provider,
your entire application's dispatch, every AI SDK patch or independent adoption.
Two operator-run installs are compatibility evidence, not two external users.
