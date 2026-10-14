# Product direction research, 2026-10-14

The user asked for invention beyond the current parser boundary, covering
everyday AI users, people coding with AI, and AI application developers.
The preceding [external fit audit](../../docs/EXTERNAL_FIT_AUDIT.md) examined
execution-integrity fit; it did not establish that all valuable adjacent
product opportunities had been exhausted.

This is a targeted primary-source scan, not an exhaustive internet survey or
a representative estimate of how often these problems occur. GitHub reports
are evidence that someone experienced a problem; their existence does not
prove demand for this particular product.

## Opportunities compared

| Direction | Concrete pain evidence | Existing approaches | Decision |
| --- | --- | --- | --- |
| Stop repetitive agent work before it consumes more budget | [LangChain #37961](https://github.com/langchain-ai/langchain/issues/37961) describes a maintainer-reported costly loop; [#36139](https://github.com/langchain-ai/langchain/issues/36139) requests progress-aware termination. [OpenCode #25254](https://github.com/anomalyco/opencode/issues/25254) describes repeated-call detection gaps, with an independent repetition report. | [AI SDK loop control](https://ai-sdk.dev/docs/agents/loop-control), [LangChain call limits/retry middleware](https://docs.langchain.com/oss/javascript/langchain/middleware/built-in), and the existing [Gemini DejaVu plugin](https://github.com/isac322/opencode-gemini-dejavu) already cover significant parts. Vendor replies in issue threads are not independent product validation. | A useful problem, but another exact-call hash counter is a weak initial differentiator and does not directly serve everyday chat users. No new runtime loop guard added. |
| Resume consequential actions without duplication | [LangGraph #9106](https://github.com/langchain-ai/langgraph/issues/9106) and [#6792](https://github.com/langchain-ai/langgraph/issues/6792) document replay/interrupt problems. | [LangGraph interrupt guidance](https://docs.langchain.com/oss/python/langgraph/interrupts) describes idempotent effects. [Temporal's state/effect example](https://docs.temporal.io/ai/featured/memory-state-stripe) separates execution state from provider-side effect state. | Valuable to application builders, but a safe implementation needs durable coordination and effect reconciliation. A local receipt cannot create distributed exactly-once semantics. Not the first universal product experiment. |
| Carry current intent and the basis for progress between conversations | [Claude Code #23776](https://github.com/anthropics/claude-code/issues/23776) reports user intent changing in a compaction summary; it is closed as a duplicate. [Codex #35226](https://github.com/openai/codex/issues/35226) reports progress loss and repeated work. [#33942](https://github.com/openai/codex/issues/33942) describes Chat/Work context separation; [#15349](https://github.com/openai/codex/issues/15349) includes cross-product history-loss reports. These reports do not establish a common root cause or that every current release is affected. | Project memory, instruction files, memory SDKs, manual summaries and task documents already address continuity. | Selected for a small prototype because all three audiences can test the same user-controlled workflow without a provider API, hidden transcript access or a new agent runtime. |

## Existing products: credit their actual capability

| Primary source | Supported workflow | What this experiment is testing alongside it |
| --- | --- | --- |
| [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) | Project context can use chats, files and instructions; memory behavior depends on project/account settings. | An explicit portable task file and human-readable continuation packet, with visible claim/review states. Not a claim to replace project memory. |
| [Claude Code memory](https://code.claude.com/docs/en/memory) | Instruction files, automatic memory and shared instruction-file patterns. Its documented prompt audit also checks stale or conflicting instructions. | Bind task reports to a particular project and intent revision, and recheck the basis for completion after edits. Not a claim that other tools cannot audit instructions. |
| [Mem0 memory updates](https://docs.mem0.ai/core-concepts/memory-operations/update) | Application-managed updates to remembered text and metadata, including OSS APIs. | A direct end-user workflow separating the current request, AI claims and manual review without implementing a memory service. |
| [Letta memory blocks](https://docs.letta.com/tutorials/attaching-detaching-blocks/) | Persistent structured context that can be attached to multiple agents. | A manually portable task record that also carries unresolved work and file fingerprints. Not a comparison of retrieval quality. |

These are documentation comparisons. No controlled usability, retention,
retrieval-quality, accuracy or pricing benchmark against those products was
run. This is not evidence that Devam's combination is unique.

## The prototype's specific hypothesis

People who switch AI conversations for the same task may value a compact
record answering three questions together:

1. What is the latest thing I actually asked for?
2. Which completion claims have I reviewed, and against which file bytes?
3. What still needs attention in the next conversation?

The deterministic part can refuse a report for the wrong task/revision and
avoid promoting a model's completion claim into a user review. It cannot
infer whether arbitrary work is correct. That limitation is reflected in the
UI and in the [prototype documentation](README.md).

The three built-in examples are illustrative tasks authored for the
prototype, not real customer incidents, existing integrations or adoption
evidence. The browser tests prove mechanics, not user value.

## Evidence needed before expanding

Test whether people can create a task, switch conversations and continue
without restating their requirements; record the time and effort compared
with their ordinary summary or project-memory workflow. Include at least one
person from each of the three audiences. Observe whether they choose to use
the same record for a second real task without prompting.

The key risks are manual setup, extra review/file steps, and the possibility
that a simple document is good enough. If those costs outweigh fewer repeated
explanations or fewer mistaken completion claims, shrink or stop the product
direction. No accounts, billing, browser extension, large memory backend or
additional runtime policy should be built before that signal.
