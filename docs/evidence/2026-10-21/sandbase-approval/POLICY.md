# Deferred approval evaluation: policy fixed before measurement

Scope: Sandbase main `427b52a96a5309ca23268407f85c237468ab6a4e`, its unchanged
npm lock, its actual SessionManager, DefaultSessionExecutor, DefaultStrategy,
confirmation resolver, SQLite event log and temporary local sandbox.
PSJ main is `bb807b39869a400f5fb5e000dc0556a86c084fde`. Open PSJ PRs 90/91/92
and Sandbase upgrade PR 965 are observation only; no branch or dependency
upgrade is part of this experiment.

Expected behavior is taken from Sandbase's existing
[confirmation reliability tests](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/tests/integration/tool-confirmation-reliability.test.ts)
and [contributor rule](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/CONTRIBUTING.md)
to validate raw data before persistence and consume confirmation once.

| Existing case | Required durable pending call | Required write / continuation behavior |
| --- | --- | --- |
| Healthy, complete and schema-valid | Exactly one; original validated arguments | Zero writes before allow; one successful file write after allow; normal continuation |
| Complete JSON with length finish | None | No write, even if an allow is attempted |
| Schema-invalid arguments | None | No write, even if an allow is attempted |
| Raw arguments conflict with parsed projection | Exactly one, containing raw.txt/raw | Allow writes raw.txt/raw, never projection.txt/projection; normal continuation; rejecting valid raw input counts as unnecessary refusal |
| Repeated approval of healthy call | One pending call, then one accepted durable confirmation | First allow writes once; later allow rejected, no additional write or model continuation |

A is the installed PSJ integration. B removes only PSJ's argument-admission
decision and uses SDK-projected valid calls, preserving native SDK checks and
the application's permission/confirmation machinery. C receives the identical
fullStream lifecycle and uses an application-owned finish/schema/identity and
raw-argument check; it must satisfy the same policy, including raw input winning
over a conflicting projection. Native deferred tool definitions must preserve
the current execution lock's approval barrier. All modes keep SessionManager
confirmation admission, the resolver's persisted input and replay checks.

Measure persisted record/input, actual file bytes and successful writes before
and after allow, repeated-allow outcome, continuation, and unnecessary refusal.
The existing attempted-write counter alone is not proof of a successful write.
Keep inputs, model script, dependency versions, permissions and execution path
identical. Hash the emitted model script and observed lifecycle for comparison.

The fixture's model protocol `specificationVersion: 'v4'` is not AI SDK version
4. Use the actually installed package versions from the current lock. These
scripted model cases are not real-provider incidents. No latency/maintenance
advantage, new user, production deployment, new adapter or feature is assumed.
If C matches A, report equivalent measured behavior and unmeasured maintenance
preference. Do not add cases to obtain a preferred conclusion.
