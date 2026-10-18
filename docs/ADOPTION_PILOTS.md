# Own-project evaluation

The new integration reduces the first supported AI SDK path to a provider
factory and a normal call with ordinary tool callbacks. SDK-owned result
serialization and continuation are exercised by the
[installed guarded-chat example](../examples/guarded-chat/README.md).
The preview's full-response buffering and narrower tool policy remain costs
to evaluate, not reasons to assume a developer will adopt it.

## localmd: SDK-upgrade regression checks

The existing [history tests at the reviewed source](https://github.com/whitefoxx/localmd/blob/d5087f2a8c1b730ecc0b5dad00a33b2a8719e7e3/src/agent/run.test.ts)
explicitly retain tool-history assumptions that can change on SDK upgrades.
That is independent evidence of an existing maintenance task. Interest in a
PSJ dependency or repeated use has not been confirmed by the maintainer.

[Draft evaluation PR](https://github.com/whitefoxx/localmd/pull/1) adds four
original-SSE cases beside those tests. It keeps the project's AI SDK 7.0.29
and provider 3.0.11 pins and uses the public integration preview as a
development dependency. Its paired native/guarded positive controls retain
two complete results and the final answer. Ambiguous or malformed batches
must release no callbacks or continuation request.

Operator evidence:

- The existing two tests and the proposed four cases pass under the project's
  installed SDK and public preview tarball.
- The same two files also pass in an isolated SDK 7.0.143/provider 3.0.71
  consumer. That is a boundary test, not a whole-application upgrade claim.
- The isolated project typecheck and 1,551 unit tests pass. Proposed frozen
  dependency metadata passes `npm ci --dry-run`; no existing locked version
  changed.
- Full browser validation remains incomplete. The attempted suite encountered
  citation-picker and graph failures. The draft records that limitation and
  the additional serving warning in an unchanged-source browser control.

The application's existing `prepareStep`, provider selection and permission
flow stay in production. The proposed use is an offline SDK regression check;
the first guarded-chat adapter does not replace that broader agent loop.

## Evidence still needed

The PR asks whether the additional development dependency is worth retaining
in normal SDK-upgrade checks. A maintainer's own project run can establish
initial use. A later independently confirmed rerun after a lockfile update or
another incident can establish repeated use. A kept test, a rejected dependency
and a specific integration blocker are distinct outcomes to record.

Current stage: **operator-tested proposal, awaiting maintainer evaluation**.
New independent developers confirmed by this pilot: **zero**. CI initiated by
the PSJ maintainer, public downloads and a proposed patch do not change that
count. The campaign's five-developer goal remains open.

The existing four-hour adoption workflow tracks the PR and surfaces public
feedback for manual review. It sends no reminders and does not infer adoption.
