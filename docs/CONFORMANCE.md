# Tool Call Integrity conformance

`conformance/` packages the class of failures this project exists to
prevent into a portable, provider-neutral fixture format and a small
deterministic runner. It is a public asset in its own right: the fixture
format and expected outcomes are meaningful to evaluate against *any*
implementation of this problem class, not only `prefix-safe-json`. A
project that never installs this package at runtime can still use these
fixtures to check its own tool-call lifecycle handling by hand or against
its own harness.

## Format

A fixture is one JSON file (schema: `conformance/schema/fixture.schema.json`):

```json
{
  "version": 1,
  "id": "C01-clean-single-call",
  "description": "...",
  "provenance": { "classification": "protocol-realistic" },
  "events": [ /* NormalizedToolStreamEvent[] */ ],
  "expected": [
    { "name": "get_weather", "action": "execute", "reason": "complete" }
  ]
}
```

- **`events`** is expressed as `NormalizedToolStreamEvent[]` — the exact
  provider-neutral shape every adapter in this package already emits
  (`tool_call_start`, `tool_call_arguments_delta`, `tool_call_end`,
  `provider_diagnostic`, `provider_stream_end`, ...), not a raw provider
  wire format. Reading or writing a fixture never requires knowing a
  specific SDK's shape. See `NormalizedToolStreamEvent` in the package's
  own public types.
- **`expected`** is one entry per tool call, matched against the real
  decisions produced by `name` (falling back to `toolIndex`). Each entry
  states the exact `action`/`reason` pair the execution-authority layer
  must produce — see `docs/EXECUTION_GATE.md` for what each value means.
- **`provenance.classification`** is mandatory and one of:
  - `protocol-realistic` — this exact sequence has been observed, or is
    directly documented as possible, in a real provider's stream.
  - `sdk-representable` — the installed provider SDK's own types permit
    constructing and receiving this sequence, but it has not been
    independently confirmed that a real provider sends it.
  - `synthetic-adversarial` — constructed to stress a specific boundary
    with no claim that any provider produces it.

  A fixture is never presented as an observed production bug unless its
  classification says so.

## Running the corpus

```ts
import { runToolCallIntegrityFixture, runToolCallIntegritySuite } from "prefix-safe-json/conformance";

const result = runToolCallIntegrityFixture(fixture); // { id, pass, calls, unmatchedActualCount }
```

The runner pushes `fixture.events` through this package's real,
unmodified `createToolCallExecutionGate()` — not a reimplementation —
and compares the resulting decisions against `fixture.expected`.
Deterministic: no network, no provider API key, no model call. This
package's own test suite dogfoods it directly
(`test/conformance/conformance-suite.test.ts`) rather than maintaining a
second, parallel truth set.

## Initial corpus (v1, 15 fixtures)

| ID | Class | Classification |
| --- | --- | --- |
| C01 | clean-single-call | protocol-realistic |
| C02 | truncated-invalid-json | protocol-realistic |
| C03 | truncated-but-valid-json (the "unsafe finish reason" case — see [vercel/ai#19063](https://github.com/vercel/ai/issues/19063)) | protocol-realistic |
| C04 | unsafe-finish-length (stream abandons a call with no terminal at all) | protocol-realistic |
| C05 | provider-error | protocol-realistic |
| C06 | content-filter | protocol-realistic |
| C07 | parallel-calls (concurrently interleaved) | protocol-realistic |
| C08 | id-less-continuation (identity carried by `callRef` alone) | protocol-realistic |
| C09 | conflicting-identity (duplicate `tool_call_start`) | synthetic-adversarial |
| C11 | post-terminal-argument-evidence | protocol-realistic |
| C12 | duplicate-terminal | protocol-realistic |
| C13 | sdk-execution-already-observed | protocol-realistic |
| C14 | malformed-json | protocol-realistic |
| C15 | schema-invalid | protocol-realistic |
| C16 | clean-multi-call (sequential, as distinct from C07) | protocol-realistic |

### C10 — deliberately not a fixture

`C10 conflicting-delta-vs-terminal-value` (a terminal event carrying its
own final argument value that disagrees with what was accumulated via
deltas) is **not representable at this normalized-event layer** and is
documented here rather than forced into a misleading fixture.
`NormalizedToolStreamEvent`'s own `tool_call_end` carries no value field —
argument text only ever arrives via `tool_call_arguments_delta` — so this
class of ambiguity is resolved one layer below, inside each provider
adapter, before a normalized event sequence exists at all. (This is
exactly the class of bug found and reproduced against a provider whose
raw protocol *does* carry a separate terminal value — see the delta vs.
`function_call_arguments.done` vs. `output_item.done` disagreement
investigated for `earendil-works/pi` — and exactly what a provider
adapter in this package must resolve internally, which the existing
internal `corpus/provider-envelopes/` fixtures verify per-provider,
not this public, protocol-neutral corpus.)

### Adapter-detected vs. coordinator-detected anomalies

C11 and C12 model diagnostics (`E_TOOL_ARGUMENTS_AFTER_END`,
`E_DUPLICATE_TOOL_END`) that every current provider adapter emits from
raw wire evidence — detecting them requires seeing the *raw* provider
event shape, which this normalized-event layer does not have access to.
The fixtures therefore include the diagnostic explicitly as part of the
input, modeling "a provider adapter already detected and reported this,"
and verify that the coordinator/gate correctly turns it into a closed
decision. A bare late/duplicate normalized event with no such diagnostic
is a different, weaker case (it still cannot execute, but resolves via
this package's general trailing-data handling as `retry`/
`stream_incomplete` rather than `reject`/`protocol_violation`) — real,
but not what these two fixtures are testing.

## A future compatibility matrix

`prefix-safe-json` is the reference implementation and, today, the only
runtime this corpus runs against. The format is designed so that changes:

| Runtime | clean | length | conflicting evidence | parallel identity | post-terminal |
| --- | ---: | ---: | ---: | ---: | ---: |
| `prefix-safe-json` (reference) | ✅ | ✅ | ✅ | ✅ | ✅ |
| *(others go here as they run the same corpus)* | | | | | |

No hosted dashboard is planned. If/when another runtime runs this corpus,
its results belong here as a plain table row, not a service.

## Adding a fixture

1. Write a new `conformance/fixtures/C##-name.json` matching
   `conformance/schema/fixture.schema.json`.
2. Set `provenance.classification` honestly — do not default to
   `protocol-realistic` without a real basis for it.
3. Run `pnpm test test/conformance/` — the suite loads every fixture in
   the directory automatically; no registration step is needed.
