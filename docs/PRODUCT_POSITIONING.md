# Product Positioning

This document is the canonical positioning source of truth for
`prefix-safe-json`. It exists to keep the README, release notes, issue
triage, and any future contributor's mental model pointed at the same
boundary. When product-surface documents disagree, this document wins.

## Category

**Tool-call execution integrity.**

## One-line description

> Fail-closed execution integrity for streamed LLM tool calls.

## Core question

The package answers exactly one question, for exactly one tool call, exactly
once:

> Has enough trustworthy provider evidence arrived to authorize this
> specific tool call exactly once?

Everything the package does traces back to that question. Everything it
refuses to do exists because answering it does not require doing that thing.

## The core invariant

> **Parse completion is not execution authority.**

A string that parses as valid JSON is not the same fact as "the provider is
finished sending this call's arguments and there is no earlier evidence this
value contradicts." Streamed tool calls fail in the gap between those two
facts — not because JSON parsing is hard, but because *lifecycle* evidence
(which chunk is final, which call a fragment belongs to, whether a later
chunk is allowed to overrule an earlier one) is scattered across a provider
stream and easy to get wrong once, silently, in a way indistinguishable
from correct behavior until the wrong tool call runs.

## The pipeline

```text
provider / SDK stream evidence
        ↓
tool-call identity
        ↓
raw argument evidence
        ↓
lifecycle / terminal evidence
        ↓
consistency checks
        ↓
optional caller-owned validation
        ↓
one-shot execution authority
        ↓
caller-owned side effect
```

The package owns every step up through "one-shot execution authority." It
never performs the side effect itself — `takeDecision()` returns a value at
most once; what the caller does with that value is entirely the caller's.

## Owns

- Raw streamed argument evidence (accumulation, not authorship)
- Identity correlation across a provider's own delta/id/index shapes
- Lifecycle completeness (has this call's stream actually ended)
- Terminal-state evidence (which event is allowed to be the last word)
- Truncation detection (parseable is not the same as complete)
- Conflicting evidence (a later chunk disagreeing with an earlier one)
- Schema/validator verdict composition (one more piece of evidence, not a
  second authority)
- One-shot authority consumption (a decision can be taken exactly once)

## Does not own

- Tool permission — whether this tool is allowed to run at all
- Application authorization — whether this caller/session/user may run it
- Human approval — whether a person should be asked first
- Sandboxing — how a side effect is isolated once authorized
- Application idempotency — what happens if the same call is retried
- Distributed exactly-once semantics — coordination across processes/machines
- Prompt injection — content-level manipulation of the model, not stream
  lifecycle integrity
- Provider-side tool execution (e.g. server-executed tools) — outside the
  boundary because the package never observes the provider's own execution
- Business transactions of any kind

If a feature request requires reasoning about any item in this list, it
belongs in the caller, in an extension, or in a different package — not
here. See `docs/THREAT_MODEL.md` for the fuller non-goals treatment this
summary is drawn from.

## Non-negotiable framing

- **The package must never perform the side effect itself.** No adapter,
  guard, or lock in this codebase calls a tool, writes a file, makes a
  request, or otherwise crosses into caller-owned effects. If a future
  change would require it to, that change does not belong in this package.
- **A validator verdict is evidence, not authority.** Schema validity can
  make a decision `reject`; it can never by itself make one `execute`. See
  `docs/EXECUTION_GATE.md` for the full decision table this composes with.
- **"Safe to execute" is scoped to this guarantee.** The package is not a
  sandbox, an authorization system, or a security suite. Language choices
  throughout the project's documentation are deliberate about this — see
  the security-language guidance embedded in `docs/THREAT_MODEL.md`.

## Reference implementation framing

`prefix-safe-json` is the reference implementation of this boundary for
TypeScript/JavaScript streamed-LLM tool calling. It is not a standard body,
not an RFC, and does not claim to be the only correct way to solve this
problem — `conformance/` exists so that the *problem class* (see
`docs/CONFORMANCE.md`) can be evaluated independently of whether a project
adopts this specific package.
