# Original call identity: a fair local alternative

This evaluation asks one question: must two tool calls with the same **original
wire ID** be refused before either update runs? This is an application policy,
not an automatic SDK defect. The calls have different valid arguments. This is
not semantic duplicate-action detection or distributed exactly-once execution.

Three paths receive byte-identical authored SSE, including bytewise transport,
the same schema, prompt, tool callbacks, model settings and continuation answer:

1. Native AI SDK and its OpenAI-compatible provider.
2. The same SDK with a small application-owned `fetch` wrapper. It receives the
   original bytes too, buffers a bounded finite response, checks original IDs
   before releasing it, and leaves JSON/schema/finish checks to the SDK.
3. Published `psj-ai-sdk@0.3.2` with published core `0.6.2`.

The test asserts matching response and first-request SHA-256 hashes across all
three modes. All effects are updates to a fresh in-memory array, counted inside
the real SDK `execute` callback. No live service, model or external write runs.

## Reproduce

Use Node 22+, copy this directory to an empty location, then run:

```sh
npm ci --ignore-scripts --strict-peer-deps --engine-strict --no-audit --no-fund
npm test
```

The committed npm lock pins all dependencies; public package imports are the
only runtime inputs. No workspace files or links are required. Expected final
row: `{"kind":"summary","cases":6,"status":"PASS",...}`. The script reports
actual installed versions and OS. Reproduction uses AI **7.0.148**, provider
**3.0.75**, Zod **4.6.7**, current registry versions when measured on October 21.
This does not certify every version covered by a peer range or a live provider.

## Observed Windows result, October 21, 2026

Node 22.23.2, npm 10.9.8, Windows 11 build 26200. A separate new directory and
empty npm cache installed 19 packages with strict peers and engines enabled.
All six assertions passed. [Raw rows](../../docs/evidence/2026-10-21/raw-id-windows.jsonl)
include original hashes, callback inputs/IDs, resulting array and result IDs.

| Response / path | Updates | Continuation requests | Correct refusals | Unnecessary refusals |
| --- | ---: | ---: | ---: | ---: |
| Healthy / native | 2 | 1 | 0 | 0 |
| Healthy / raw native check | 2 | 1 | 0 | 0 |
| Healthy / PSJ | 2 | 1 | 0 | 0 |
| Repeated original ID / native | 2 | 1 | 0 | 0 |
| Repeated original ID / raw native check | 0 | 0 | 1 | 0 |
| Repeated original ID / PSJ | 0 | 0 | 1 | 0 |

Healthy paths preserve IDs `a/b`, both results and `Updated.`. In the repeated-ID
case the native provider keeps the first ID and assigns the other call a new
ID. It is not executing two unchanged duplicate IDs. The local check refuses
with `original_id_not_unique`; PSJ reports `protocol_violation`. Both refusals
release no tool-call/result event and make no continuation request. "Correct"
and "unnecessary" refer only to the stated identity policy and these fixtures,
not an estimated production error rate.

**PSJ adds an original-identity check over the native default here. It shows
no additional protection over this reasonable raw native check.** Do not use
this scenario to claim PSJ is necessary or uniquely prevents these updates.
If original-ID uniqueness is the application's only extra requirement, the
local check is an alternative to consider. The earlier normalized-stream
comparison cannot recover original identity after the provider changes it;
this control removes that restriction instead of relying on it for an advantage.

## Integration burden and limits

| Path | Extra work beyond native tools |
| --- | --- |
| Native | Existing provider factory and SDK; no added dependency or preflight |
| Raw native check | Maintain `checkRawIdentity` plus its fetch hook and tests; no added package; buffers the whole response; fixed finite Chat Completions subset |
| PSJ | Add `psj-ai-sdk` and its core peer, use `createGuardedChat`, handle refusal and check supported options; core also brings AJV dependencies; buffers tool-bearing responses until EOF and whole-group validation |

Both preflight paths use an 8 MiB response ceiling. This is not a latency,
memory or throughput benchmark. The local wrapper is inspectable evaluation
code, not production middleware: general SSE framing, transport failures,
cleanup and application lifecycle requirements would need their own validation.
No robustness advantage on untested inputs is inferred from this comparison.

PSJ's wider contract includes raw argument parsing, schema/completion evidence
and whole-group policy; those are not separately measured as added value in
this one scenario. Native JSON, schema and finish checks already exist. The
[broader comparison](../guarded-chat/comparison.mjs) retains their controls.
The companion supports Chat Completions SSE through the compatible provider,
ordinary local tools and its documented subset of options. It does not certify
other protocols, approvals, repair callbacks or an application's complete loop.
Neither path supplies authorization, sandboxing, prompt injection protection,
rollback or distributed exactly-once execution.

Before keeping it, run with your own harmless tool and supported SDK pair:
does this identity policy matter, does the small check suffice, and which
additional raw-evidence checks justify the dependency and buffering cost?
Our fixture run establishes neither incident frequency nor independent adoption.
