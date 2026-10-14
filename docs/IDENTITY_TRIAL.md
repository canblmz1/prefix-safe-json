# Compare native execution with PSJ's identity checks

Run this when your application owns tool dispatch and receives original
`streamText().fullStream` parts. It demonstrates a case distinct from token
limits: every argument object is complete and schema-valid, and the provider
reports successful termination, but two calls reuse the same identity.

From a repository checkout with Node 22+ and npm:

```bash
node scripts/try-npm-demo.mjs
```

The launcher creates an isolated project using published PSJ `0.5.2` and
`ai@7.0.77`. After the original five cases and the batch comparison, it runs
`npm run identity`. To rerun only this comparison, use that command in the
retained consumer directory. You can also copy all files from
[`examples/npm-consumer/`](../examples/npm-consumer/) into a separate project,
install its pinned dependencies and run `npm run identity` there.

## Expected result

| Authored provider fixture | Native SDK effects | Locked tools + PSJ caller effects |
| --- | --- | --- |
| Two complete calls with different IDs | 2 | 2 |
| Two complete calls reusing one ID | 2 | 0 |

The native controls deliberately execute harmless in-memory counters. In the
PSJ path, all SDK execution/input callbacks stay at zero; the caller records
an effect only after consuming `takeDecision()`. The distinct-ID control
therefore proves that the comparison is not simply disabling every tool.
Trying to consume each decision twice yields no additional authority.

For duplicate IDs, PSJ retains the ambiguous call as one refused identity,
with `reject / protocol_violation`, rather than inventing separate call IDs.
This happens even though the raw JSON is structurally complete. The example
checks both authored values separately against the same schema; a refused
identity need not reach the gate's schema-validation stage.
The example
also asserts that the SDK emitted the expected original start IDs and raw
argument deltas, and did not report an input or tool error.

The report prints effect counts, callback counts and decisions. Input values
are authored harmless fixture messages; no user data or model request is
involved. The fixture source is
[`identity-demo.mjs`](../examples/npm-consumer/identity-demo.mjs).

## Why test this boundary?

[AI SDK issue #22377](https://github.com/vercel/ai/issues/22377) reports that
duplicate call IDs can cause WorkflowAgent to associate results with the
wrong call. Its proposed result-association fix is
[PR #22391](https://github.com/vercel/ai/pull/22391), open when checked on
2026-10-14. Fixing that upstream behavior is useful independently of PSJ.

This comparison tests a related execution policy, not that WorkflowAgent
implementation. The upstream reproduction sends final `tool-call` parts;
our authored fixtures additionally emit original `tool-input-start`,
`tool-input-delta` and `tool-input-end` evidence because that is PSJ's
supported capture boundary. The example runs actual `streamText()` with the
official mock model. It does not run WorkflowAgent, repair its result
pairing, provide a drop-in agent integration, or exercise a live provider.

An OpenAI-compatible provider may already make identities unique before
`fullStream`. If the original collision is no longer visible at your chosen
boundary, this comparison does not prove that PSJ adds a benefit there.
Likewise, adding a guard after native side effects have happened cannot
protect those effects. Use the execution lock before calling `streamText()`
when choosing caller-owned execution.

## Verification scope

The installed published-package comparison was checked with `ai@7.0.140`,
the registry's latest version on 2026-10-14. CI installs the exact packed PSJ
candidate in isolated projects and runs the original, batch and identity
examples with `ai@7.0.77`, `7.0.128`, `7.0.137` and `7.0.140`.

These are deterministic operator-run SDK checks, not independent adoption,
production certification, or a claim about all providers and SDK versions.
There is no new PSJ runtime API or automatic ID remapping.

To evaluate your project, first use a harmless tool at your own dispatch
boundary and compare complete unique calls, duplicate identities visible in
the original stream, interrupted calls and repeated authority consumption.
[Report the installed versions and observed outcome](TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
