# Tool Call Integrity conformance

`conformance/` packages the class of failures this project exists to
prevent into a portable, provider-neutral fixture format and a small
deterministic runner. It is a public asset in its own right: the fixture
format and expected outcomes are meaningful to evaluate against *any*
implementation of this problem class, not only `prefix-safe-json`. A
project that never installs this package at runtime can still use these
fixtures to check its own tool-call lifecycle handling by hand or against
its own harness.

## Claim boundary: what "normalized-gate" tests, and what it does not

Every fixture declares `"profile": "normalized-gate"`. This is the only
profile v1 defines, and it makes an explicit, narrower claim than the
corpus's name might otherwise suggest:

> A `normalized-gate` fixture tests the coordinator/execution-gate's
> response to an **already-normalized** `NormalizedToolStreamEvent`
> sequence - identity correlation, lifecycle/terminal-state handling, and
> decision composition - entirely *after* a provider adapter has already
> produced that sequence.

It does **not** test, and no fixture in this corpus should ever be
described as testing:

- provider raw-wire parsing
- OpenAI `index`/`id` extraction from a raw streaming delta
- delta-vs-terminal argument consistency when a raw provider protocol's
  own terminal event carries a competing value the normalized type has no
  field to represent (`tool_call_end` carries no value - see "C10" below)
- raw post-terminal or duplicate-terminal event *detection* - i.e.
  whether an adapter correctly recognizes, from a provider's own raw wire
  shape, that a fragment or terminal signal arrived late or twice
- SDK raw/projection disagreement where the normalized input has already
  discarded one of the disagreeing representations

That surface is **provider-adapter conformance** - a distinct, currently
unwritten profile. Where this package already has adapter-level coverage
for a related concern, it lives in the separate, internal
`corpus/provider-envelopes/` fixtures (which do encode raw provider wire
shapes, and exist to prove each adapter's own translation into
`NormalizedToolStreamEvent` is correct) - not in this public corpus.

A `normalized-gate` fixture *may* legitimately include a
`provider_diagnostic` event as part of its **input**, to test how the
gate reacts once such a diagnostic exists in the normalized stream (for
example, "does a `protocol_violation`-class diagnostic correctly cause
`reject`"). What it must never do is present that as proof an adapter
*detected* the underlying raw-wire anomaly the diagnostic's code name
describes - the fixture supplies the diagnostic; it does not ask the
implementation to derive it. C11, C12, and C13 are named and worded
specifically to keep this distinction visible (see §7 below).

## Format

A fixture is one JSON file (schema: `conformance/schema/fixture.schema.json`):

```json
{
  "schemaVersion": 1,
  "profile": "normalized-gate",
  "id": "C01-clean-single-call",
  "description": "...",
  "provenance": { "classification": "protocol-realistic" },
  "events": [ /* NormalizedToolStreamEvent[] */ ],
  "expected": [
    { "name": "get_weather", "action": "execute", "reason": "complete" }
  ]
}
```

- **`profile`** is mandatory and must be `"normalized-gate"` in v1 - the
  runner throws a clear error for any other value rather than silently
  running a fixture whose claim it doesn't recognize.
- **`events`** is expressed as `NormalizedToolStreamEvent[]` — the exact
  provider-neutral shape every adapter in this package already emits, not
  a raw provider wire format.
- **`expected`** is one entry per tool call, matched against the real
  decisions produced by `name` (falling back to `toolIndex`). Each entry
  states the exact `action`/`reason` pair the execution-authority layer
  must produce — see `docs/EXECUTION_GATE.md` for what each value means.
- **`provenance.classification`** is mandatory and one of
  `protocol-realistic`, `sdk-representable`, or `synthetic-adversarial`
  (see `FixtureClassification`'s own docstring for the exact criteria for
  each). A fixture is never presented as an observed production bug
  beyond its stated classification.

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

## Distribution: fixtures are repository-only

The npm package does **not** ship the fixture JSON files. `package.json`'s
`files` field is `["dist", "LICENSE", "LICENSE-MIT", "LICENSE-APACHE",
"README.md"]` — it does not include the top-level `conformance/` directory
(`conformance/fixtures/*.json`, `conformance/schema/fixture.schema.json`),
so an `npm install prefix-safe-json` consumer receives only the compiled
runner and its types (`prefix-safe-json/conformance`, i.e.
`dist/conformance.js` + `dist/conformance/*`), never the fixture data
itself. This was verified directly against a real packed tarball
(`pnpm pack`) installed into an isolated consumer project — the corpus
files are absent from both the tarball's file list and the installed
`node_modules/prefix-safe-json/` tree.

A consumer who wants to run the actual corpus (as opposed to writing their
own fixtures against the exported types and runner) needs this repository
directly — clone it, or read `conformance/fixtures/*.json` from a specific
tagged commit/release on GitHub. This is a deliberate, low-cost distinction
worth stating plainly rather than leaving implicit: the *runner* is a
supported runtime dependency; the *corpus* is project documentation and
test data, not a runtime asset.

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
| C08 | id-less-continuation (gate correlates by sourceKey alone) | protocol-realistic |
| C09 | conflicting-identity (duplicate `tool_call_start`) | synthetic-adversarial |
| C11 | post-terminal-diagnostic-fails-closed | protocol-realistic |
| C12 | duplicate-terminal-diagnostic-fails-closed | protocol-realistic |
| C13 | sdk-execution-diagnostic-fails-closed | protocol-realistic |
| C14 | malformed-json | protocol-realistic |
| C15 | schema-invalid | protocol-realistic |
| C16 | clean-multi-call (sequential, as distinct from C07) | protocol-realistic |

15 fixtures, not 16 - see "C10" immediately below. Quality of claim over
count: a 16th case was not manufactured to round the number up.

### C10 — Provider-adapter conformance — future profile / not covered by normalized-gate v1

`C10 conflicting-delta-vs-terminal-value` (a raw terminal event carrying
its own final argument value that disagrees with what was accumulated
via deltas) is **not representable in the `normalized-gate` profile** and
is documented here rather than forced into a misleading fixture.
`NormalizedToolStreamEvent`'s own `tool_call_end` carries no value field
— argument text only ever arrives via `tool_call_arguments_delta` — so
this class of ambiguity is resolved one layer below, inside each
provider adapter, before a normalized event sequence exists at all. This
is exactly the class of bug found and reproduced against a provider whose
raw protocol *does* carry a separate terminal value (the delta vs.
`function_call_arguments.done` vs. `output_item.done` disagreement
investigated for `earendil-works/pi`) — and exactly the kind of thing a
future provider-adapter conformance profile would need its own,
raw-wire-shaped fixture format to represent. Not written in this pass.

### §7: C11 / C12 / C13 — diagnostic-driven rejection, not detection

These three fixtures include a `provider_diagnostic` event as part of
their **input** and test that the gate correctly fails the call closed
once that diagnostic is present in the normalized stream. Each is named
and worded explicitly as testing *that reaction*, not as proof any
adapter can *derive* the diagnostic from raw wire evidence:

- **C11-post-terminal-diagnostic-fails-closed** — models
  `E_TOOL_ARGUMENTS_AFTER_END`. A bare late `tool_call_arguments_delta`
  with no such diagnostic present is a different, weaker case: it
  resolves `retry`/`stream_incomplete` via this package's general
  trailing-data handling, not `reject` - see the fixture's own
  `provenance.note`.
- **C12-duplicate-terminal-diagnostic-fails-closed** — models
  `E_DUPLICATE_TOOL_END`. A bare duplicate `tool_call_end` with no such
  diagnostic present is otherwise idempotent and does not by itself
  change an already-complete call's outcome.
- **C13-sdk-execution-diagnostic-fails-closed** — models
  `E_SDK_EXECUTION_OBSERVED`, the AI SDK adapter's own normalization of a
  raw `tool-result`/`tool-error` `fullStream` part (see
  `docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence`
  for that adapter-level mechanism, which this fixture does not test).

All three diagnostic codes are real and currently emitted by this
package's own provider adapters from genuine raw wire evidence - but that
emission logic is exercised by `corpus/provider-envelopes/`, not by these
fixtures.

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
   `conformance/schema/fixture.schema.json`. Set `profile` to
   `"normalized-gate"` only if the fixture genuinely stays within that
   claim boundary (see above) - if it doesn't, it belongs to a future
   provider-adapter profile, not this corpus.
2. Set `provenance.classification` honestly — do not default to
   `protocol-realistic` without a real basis for it.
3. Name the fixture for what it tests, not for the upstream bug class
   that motivated it - see the C11/C12/C13 rationale above.
4. Run `pnpm test test/conformance/` — the suite loads every fixture in
   the directory automatically; no registration step is needed.
