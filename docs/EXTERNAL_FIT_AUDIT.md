# External fit audit, 2026-10-14

The tested execution-integrity boundary is useful in a specific integration.
The evidence does not justify positioning PSJ as a general agent-reliability
product, adding automatic continuation, or expanding replay into an
observability platform. No new runtime feature is justified by this audit.

## Results

| Target | What actually ran | Observation | Product implication |
| --- | --- | --- | --- |
| Sandbase Harness, commit `427b52a96a5309ca23268407f85c237468ab6a4e` | Two unchanged upstream integration files with locked `ai@7.0.128` / PSJ `0.5.0`, then the same files with a resolver override to published PSJ `0.5.2` | **13/13 pass in each run.** Includes real SessionManager, executor, confirmation and temporary sandbox writes: a complete confirmed call writes once; unsafe cases do not. | Concrete integration fit for caller-owned execution and confirmation. A scripted model exercises the application boundary; this is not a live-provider or new independent-user result. |
| Next AI Draw.io, commit `623eb91e579465dabe2794da5aac2dfaceba0f71` | Three unchanged upstream unit files, plus two local counterfactual tests importing the actual helper and browser tool handler | **57 upstream + 2 counterfactual tests pass.** A malformed JSON syntax case is intentionally repaired by the app but rejected by PSJ. Complete JSON containing truncated XML is accepted by PSJ; the actual app handler detects incomplete XML and requests `append_diagram`. | An unconditional strict gate is not a replacement for this application's XML recovery policy. No demonstrated need to add an XML validator or automatic continuation to PSJ. |
| AI SDK, issue reporter's `ai@7.0.137` | Installed `streamText()` with official `MockLanguageModelV4`, identical two-call fixtures with native execution versus locked tools plus PSJ `0.5.2` | Native SDK and PSJ both produce **2 effects for a completed step, 0 for a length-limited step**. | No incremental execution-suppression benefit demonstrated for this scenario. UI outcomes, skipped states and continuation remain application/SDK concerns. |
| LangChain, published `@langchain/openai@1.6.2` / `@langchain/core@1.2.17` | Actual `ChatOpenAI.stream()` parser, issue #11469 payload shape with a harmless path, mocked SSE; the same original envelopes enter PSJ `0.5.2` | A mid-string cutoff ending in `length` still produces **1 parsed tool-call candidate, 0 invalid calls**. PSJ grants **0 authorities**. An application-level finish-reason check also produces 0 dispatches in this case. Completed control: 1 candidate / 1 PSJ authority. | The projection-versus-original-evidence problem persists in these versions. This example alone does not establish that a library is preferable to a focused application check. ChatOpenAI does not itself dispatch tools in this experiment. |

The two application repositories were cloned locally. The SDK comparisons
used isolated installed packages, not full application deployments. All model
responses were deterministic fixtures; no paid model calls, user data, or
production writes were involved.

## Pain reports and existing solutions

- [OpenCode #18108](https://github.com/anomalyco/opencode/issues/18108) has
  multiple independent reports of truncated output and unrecoverable loops.
  It is closed as a V1 issue, not evidence of an unpatched V2 defect.
  [V2 #38747](https://github.com/anomalyco/opencode/issues/38747) explicitly
  reports that the native route already detects incomplete streams and asks
  for recovery. [The native parser fix #38733](https://github.com/anomalyco/opencode/pull/38733)
  is merged. PSJ does not implement that recovery policy. OpenCode was
  investigated through current issue/PR records, not executed in this audit.
- [AI SDK #22914](https://github.com/vercel/ai/issues/22914) asks for UI and
  recovery behavior after the SDK suppresses an unsafe batch. The local
  baseline confirms that suppression in the reported version. It is not
  evidence that adding PSJ solves the requested UI behavior.
- [Draw.io #924](https://github.com/DayuanJiang/next-ai-draw-io/issues/924)
  describes reasoning consuming the output budget before a diagram appears.
  The current app has its own
  [budget handling](https://github.com/DayuanJiang/next-ai-draw-io/blob/623eb91e579465dabe2794da5aac2dfaceba0f71/lib/output-token-limit.ts)
  and [XML continuation handler](https://github.com/DayuanJiang/next-ai-draw-io/blob/623eb91e579465dabe2794da5aac2dfaceba0f71/hooks/use-diagram-tool-handlers.ts).
  A reasoning-only stream contains no tool call for PSJ to adjudicate.
- [LangChain #11469](https://github.com/langchain-ai/langchainjs/issues/11469)
  supplies an independent deterministic reproducer. Proposed upstream
  [PR #11494](https://github.com/langchain-ai/langchainjs/pull/11494) is closed
  **without merging**. The local run above checks newer published packages,
  rather than assuming the old report still applies.

## A correction found in our own diagnostics

The real SDK `7.0.137` fixture emits an invalid `tool-call` followed by
`tool-error` for truncated JSON, even though the execution counter remains
zero and the PSJ lock is present. PSJ currently reports that call as
`reject / sdk_execution_observed` because its conservative error policy takes
priority over truncation.

That reason is not an execution receipt: `tool-error` can precede execution
or follow an execution attempt. The replay explanation and execution-gate
documentation have been corrected accordingly. No authority is newly granted,
and error parts remain fail-closed. Automatic retries must not be designed
around interpreting this reason as proof that a tool ran.

## Verification boundaries

The Sandbase source files are
[confirmation reliability](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/tests/integration/tool-confirmation-reliability.test.ts)
and [post-terminal authority](https://github.com/sandbaseai/sandbase-harness/blob/427b52a96a5309ca23268407f85c237468ab6a4e/tests/integration/post-terminal-authority.test.ts).
At that checkout, after `npm ci --ignore-scripts`, the baseline command is:

```bash
npm exec -- vitest run tests/integration/post-terminal-authority.test.ts tests/integration/tool-confirmation-reliability.test.ts
```

The PSJ `0.5.2` comparison changes only dependency resolution through a local
Vitest alias, not Sandbase's source or lockfile. It does not establish that
Sandbase upgraded, nor that its whole application was validated.

Draw.io's unchanged files are `chat-helpers.test.ts`,
`output-token-limit.test.ts`, and `use-diagram-tool-handlers.test.tsx` under
`tests/unit/`. A local test configuration maps application imports to the
cloned source and installs the relevant locked versions: `ai@6.0.300`,
`jsonrepair@3.13.2`, React `19.3.0`, Zod `4.6.5`, Vitest `4.1.11`.
DOM behavior uses jsdom. Full Next.js, browser, visual, deployment and
live-provider checks were not run.

Local JSON reports, comparison harnesses, lockfiles and synthetic traces were
retained as the audit evidence bundle. These runs were performed by this
project's operator. They are neither independent adoption nor market-demand
validation; no performance benchmark or population-wide frequency was measured.

## Development decision

### Maintainer feedback received on 2026-10-15

The [SideCar maintainer's response](https://github.com/nedonatelli/sidecar/issues/164#issuecomment-6179590817)
independently confirms that its Anthropic path did not check the token-limit
reason before dispatch and treated EOF without terminal evidence as `end_turn`.
They plan an in-tree ML-15 correction and the proposed harmless-counter
regression shape. Completion of that fix has not been verified here.

They explicitly declined both a PSJ dependency and running the demo, citing
their primary native Ollama path and its different completion policy. This is
problem validation and useful technical feedback, not PSJ adoption. It does
not justify adding native Ollama support without a demonstrated integration
requirement, nor claiming Anthropic message events apply to that protocol.

### Runtime scope

Keep the existing narrow execution-integrity core. Before adding a runtime
capability, require a reproducible adopter failure and compare the existing
SDK or application fix. For replay product expansion, require an external
developer to bring an actual incident and use the resulting check again.
Until then, keep replay experimental. Do not add retry orchestration, diagram
repair, token-budget management or a dashboard on the strength of these reports.
