# Whole-response validation and per-call core decisions

Starting point: `5ed764c72c9e2a1a12eaed9725d527a147a5da85`, core 0.6.1 and
companion 0.3.1. PR #88 had merged; the npm registry listed companion 0.3.1.
The fixes are prepared as core 0.6.2 and companion 0.3.2. A prepared artifact,
merged PR or successful CI run is not itself evidence of registry publication.

## Two contracts

The core gate returns one decision per coordinator-created call. It also
returns the complete `finish().diagnostics` list, including errors for calls
that never acquired a coordinator state. Its documented call-scoped authority
is preserved: a caller may intentionally apply a different group policy.

The companion instead promises to validate the entire original response's
call group before releasing any tool-bearing bytes to the SDK. Looking only
at `decisions` cannot establish that every call was accounted for. It now:

1. Refuses if any tracked call is not executable, preserving its specific
   schema, JSON or completion reason.
2. Refuses any remaining coordinator `error` or `fatal` diagnostic, including
   diagnostics with no `internalId` or an unresolved `sourceKey`.
3. Requires an original, nonempty string tool-call ID for every tracked call.
4. Validates the original application schemas without changing the JSON,
   then commits callback authority only after the complete group succeeds.

Steps 1–3 run before application validation or consumption of any one-shot
core decision. `warning` and `info` diagnostics do not refuse a healthy group;
supported provider extension fields remain observational. This rule uses
diagnostic severity rather than guessing that every unfamiliar provider
field is an error.

| Evidence | Companion reason when otherwise executable |
| --- | --- |
| `E_COORDINATOR_LIMIT_CALLS` or event/name resource limits | `resource_limit` |
| Dropped malformed provider call, including invalid index | `unaccounted_call` |
| `E_TOOL_CALL_NOT_FOUND` or missing original ID | `unresolved_call` |
| Other error/fatal coordinator evidence | `protocol_violation` |

The limit remains 128. Increasing it would move the failure boundary without
repairing the missing-evidence policy.

## Reproduced callback behavior

The before run uses the downloaded, published 0.3.1 workflow artifact. The
after run uses the corrected companion through the real installed SDK/provider.
All examples are authored HTTP/SSE fixtures, not production incident samples.

| Original response | Before callbacks | After callbacks | After requests |
| --- | ---: | ---: | ---: |
| 127 valid calls | 127 | 127 | 2, including result continuation |
| 128 valid calls | 128 | 128 | 2, including result continuation |
| 129 calls, final call valid | 128 | 0 | 1 |
| 129 calls, final call schema-invalid | 128 | 0 | 1 |
| Two calls, second index negative | 1 | 0 | 1 |
| Two calls, second index fractional | 1 | 0 | 1 |
| Two calls, second index missing | 1 | 0 | 1 |
| Two calls, second schema-invalid | 0 | 0 | 1 |

The regression checks callbacks, original IDs and returned result IDs,
released SDK tool-call/result parts, observer decisions, application validator
counts and continuation requests. A separate one-call configured-limit check
proves the global diagnostic survives the outer gate; the wire policy returns
no gate/authority for that group. Its one-call healthy control consumes an
original-ID authority exactly once. Core tests demonstrate that the core's
per-call decision remains available until consumed under its own contract.

See [companion regressions](../packages/ai-sdk/test/batch.test.mjs),
[core evidence tests](../test/unit/execution-gate-batch-evidence.test.ts) and
the [three-way evaluation kit](COMPANION_EVALUATION.md).

This is validation before callbacks begin. It supplies no authorization,
sandbox, prompt-injection protection, distributed exactly-once execution or
rollback of effects from a callback that has already run.
