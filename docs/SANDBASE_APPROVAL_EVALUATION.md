# Sandbase deferred approval: equivalent measured policy

**Decision:** existing PSJ admission and a small native check meet the same
policy in all five selected cases. Both improve on projection-only admission
in this application's current configuration. The experiment does **not**
establish an advantage over the reasonable native alternative or a lower
maintenance cost. No extra scenarios were added to obtain a PSJ advantage.

## Fixed sources and policy

Sandbase main is
[`427b52a96a5309ca23268407f85c237468ab6a4e`](https://github.com/sandbaseai/sandbase-harness/tree/427b52a96a5309ca23268407f85c237468ab6a4e).
PSJ main is `bb807b39869a400f5fb5e000dc0556a86c084fde`. The
[PR snapshot](evidence/2026-10-21/sandbase-approval/reviewed-prs.json) records
PSJ #90/#91/#92 open, at their existing heads, each with 16 successful checks.
Their branches were not changed. Sandbase [upgrade PR 965](https://github.com/sandbaseai/sandbase-harness/pull/965)
remains open at `f2866b9f7bf331c0479ac93364234f4afc81653c`; its dependency upgrade
was neither repeated nor applied to this experiment.

The unchanged Sandbase lock installs **AI SDK 7.0.128**, **PSJ 0.5.0**,
Zod **4.6.5**, Vitest **5.0.3** and TypeScript **7.0.2**. It is the current
application's locked SDK7 path, not a registry-latest upgrade exercise. The
scripted model's `specificationVersion: 'v4'` is a model-protocol version,
not AI SDK package version 4. No old SDK4 execution result is reused as an
SDK7 result, and no real-provider incident or frequency is claimed.

The [policy](evidence/2026-10-21/sandbase-approval/POLICY.md) was committed
**before measurement**, at `2129d29106847f1ad8e7177074001406c6123155`. It follows
the existing reliability tests and maintainer rule to validate raw evidence
before persistence. A healthy raw/projection disagreement must persist and
execute the valid **raw** argument; simply refusing it would fail the policy.

## The actual application path

The [test-only patch](evidence/2026-10-21/sandbase-approval/experiment.patch)
adds 198 lines and removes five. It reuses `scriptedToolModel`, `createHarness`, `requestToolCall` and the counting
sandbox in Sandbase's existing
[`tool-confirmation-reliability.test.ts`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/tests/integration/tool-confirmation-reliability.test.ts).
It does not create another application or copy Sandbase into this repository.
Production `src`, package manifest and lock remain unchanged.

All paths use real SessionManager → DefaultSessionExecutor → DefaultStrategy
→ SQLite event log → user confirmation → ToolResolver → LocalSandboxProvider.
The same `always_ask` write policy, tool schema, fixture, SDK and temporary-file
flow remain in place. Initial tool definitions cannot execute: every mode
removes model-facing `execute` and sets SDK `needsApproval: true`.

- **A / `psj`:** the actual existing execution lock and
  `createAiSdkV4ExecutionGuard`. The test wrapper observes its input and result;
  the actual guard makes its normal admission decision.
- **B / `native`:** equivalent native deferred tool definitions and a test
  bridge that admits SDK-projected, non-invalid calls at the existing seam.
  SDK parsing/error handling, name/ID matching, application permissions,
  deferred executor and persistent replay checks remain. It adds no new
  finish/raw/schema policy.
- **C / `native-check`:** B's native barrier, plus completion/finish,
  raw-lifecycle identity and schema checks at the same drained `fullStream`
  seam. It parses the original argument text once and validates against the
  real tool schema using the already installed direct Zod dependency. It keeps
  the original parsed raw value, not a transformed validator result. It does
  not invoke PSJ parsing, validation or admission.

The new helper is 73 lines including the native deferred definitions and test
bridges. This is source size, **not a maintenance-cost measurement**. Its narrow
implementation is evidence for these five cases, not a production adapter,
new supported protocol, general schema-compatibility certificate or replacement
for PSJ's complete contract. No dependency or feature is added to either product.

## Measured outcomes

Every cell below is **pending record / input / successful writes after allow**.
Actual file contents and error tool results are in the raw records.

| Existing case | A: current PSJ | B: SDK + current app controls | C: SDK + small native check |
| --- | --- | --- | --- |
| Healthy | 1 / safe.txt: safe / 1 | Same | Same |
| Complete JSON, length finish | 0 / none / 0 | 1 / length.txt: incomplete turn / 1 | 0 / none / 0 |
| Schema-invalid | 0 / none / 0 | 1 / missing-content.txt, no content / **0 successful, 1 attempted** | 0 / none / 0 |
| Raw/projection conflict | 1 / raw.txt: raw / 1 | 1 / projection.txt: projection / 1 | 1 / raw.txt: raw / 1 |
| Healthy reapproval | 1 / safe.txt: safe / 1 | Same | Same |

Across all 15 rows:

- Before approval, **zero attempted and zero successful writes**, with all
  fixture files absent. This verifies that removing PSJ admission did not
  remove the approval barrier.
- Every repeated allow is rejected by the existing application. It adds
  **zero writes, zero file changes and zero model requests**. One healthy
  case repeats after the turn; the reapproval case queues the duplicate before
  the first turn resolves, as in the existing test.
- Healthy controls retain one successful write, the paired original
  `call_write_1` result and normal `continued` response. No unnecessary refusal
  is observed, including the valid raw/projection conflict.
- Pending calls and accepted confirmations are reread through a **fresh SQLite
  connection**. File contents are read from the real sandbox. The success
  counter increments only after the real write completes. The original
  attempted-write counter is retained separately.

Policy satisfaction: **A 5/5, B 2/5, C 5/5**. Those are fixture counts, not
production success rates. B's schema-invalid approval reaches the real write
function, whose file API throws for missing content; no file is successfully
written. Its model continuation contains an error tool result, not a successful
write result.

The schema difference is specific to Sandbase's configuration:
[`toAiTool`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/strategy/default-strategy.ts)
uses `jsonSchema(parameters)` without a validation callback. Installed
provider-utils accepts a value when that callback is absent. This does **not**
mean SDK7 cannot validate schemas. C adds the missing application validation
using the same schema. Similarly, a tool call being available for deferred
approval is distinct from a claim about native automatic execution callbacks.

Duplicate approval protection belongs to
[`SessionManager`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/core/session/session-manager.ts)
and the existing
[`ToolResolver`](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/src/core/session/tool-resolver.ts),
which execute persisted `block.input` and reject prior decisions/results.
Matching repeat behavior is not unique PSJ replay protection or distributed
exactly-once execution. No authorization, sandbox, rollback or prompt-injection
guarantee is added by the admission check.

## Reproduce from clean source

Node 22+ and npm are required. From a checkout of this PSJ evidence branch,
create a separate new Sandbase directory with LF checkout bytes:

```sh
git clone --no-checkout --config core.autocrlf=false --config core.eol=lf https://github.com/sandbaseai/sandbase-harness.git ../sandbase-approval
git -C ../sandbase-approval checkout --detach 427b52a96a5309ca23268407f85c237468ab6a4e
npm --prefix ../sandbase-approval ci --ignore-scripts --strict-peer-deps --no-audit --no-fund
node scripts/evaluate-sandbase-approval.mjs --checkout ../sandbase-approval --output ../sandbase-approval-results
```

The runner requires a clean exact source head, original lock SHA-256, installed
locked versions, no dependency overlay, and a new output directory outside
Sandbase with an existing parent. Source/output-parent paths are resolved before
the outside-checkout check. It never resets changes or deletes old evidence. It runs
the two original files **before applying** the test-only patch, then applies
that patch, runs the same five cases in each mode and checks source/test/Console
types. It leaves the reviewable test patch in the disposable checkout.

Expected output: baseline **13 passing**, **15 completed measurements**,
three successful TypeScript commands and summary scores **5 / 2 / 5**.
The native mode's measurement tests passing does **not** mean it meets all
five policy expectations: the recorded `policySatisfied` fields preserve the
three mismatches. The ten original reliability cases are skipped only inside
each mode-specific process; all ten plus the three authority cases ran in the
pristine 13-case baseline first. No skipped case is reported as passed.

The runner asserts identical fixture hashes and selected initial lifecycle
records across modes, then deep-compares A/C's recorded admission, disk,
approval and continuation outcomes. All modes receive every real `fullStream`
part; the retained trace selects relevant lifecycle fields rather than claiming
to be a complete HTTP wire capture. No model service/key is needed.

## Verification and limits

Windows 11 build 26200, Node **22.23.2**, npm **10.9.8**: a fresh separate
worktree installed **383 packages**, strict peers enabled, no prior modules,
junction or overlay. The manifest/lock remained unchanged. The final runner
then completed baseline 13/13, all 15 measurements, all three TypeScript
programs and diff checks with exit 0. Existing Vite configuration and Node
experimental SQLite warnings remain visible in the logs; they did not fail
these checks. The CI job repeats the pinned clone/install and entire runner
and retains its own records. Windows success is not substituted for CI results.

Evidence:

- [Install receipt](evidence/2026-10-21/sandbase-approval/installation.json),
  [installed environment and hashes](evidence/2026-10-21/sandbase-approval/windows-environment.json),
  [actual commands/exits](evidence/2026-10-21/sandbase-approval/windows-commands.json).
- [Runner checks](evidence/2026-10-21/sandbase-approval/runner-validation.json):
  frozen offline PSJ install, full zero-warning lint, syntax and source/output
  mutation guards. Its plain-JS lint override preserves the rules and avoids
  consuming an inferred TypeScript project slot; existing files stay unchanged.
- Raw [A](evidence/2026-10-21/sandbase-approval/windows-results-psj.jsonl),
  [B](evidence/2026-10-21/sandbase-approval/windows-results-native.jsonl),
  [C](evidence/2026-10-21/sandbase-approval/windows-results-native-check.jsonl),
  [summary](evidence/2026-10-21/sandbase-approval/windows-summary.json) and
  [pristine baseline log](evidence/2026-10-21/sandbase-approval/windows-baseline.txt).
- [Independent read-only review](evidence/2026-10-21/sandbase-approval/REVIEW.md).

The application-wide release/browser/live-provider gate was not run locally;
this is a narrow admission experiment, not whole-application certification.
The existing teardown removes temporary databases and files after their values
are read. No process-restart, crash recovery, distributed replay or performance
measurement is claimed. Maintenance preference is unmeasured; fewer call-site
lines do not establish a lower ongoing cost.

Sandbase is an existing core integration. This operator experiment is not a
new user, new maintainer acceptance or retained-use report. The five-project
goal counts independent projects once across core and companion, never twice
for using both. No localmd/Sandbase invitation, external message, external PR,
dependency upgrade, merge or publication was made. Merge remains with Kübra.
