# OpenRouter Agent: manual dispatch and continuation

With Node 22+ and npm, run from the repository checkout:

```bash
node scripts/try-npm-demo.mjs openrouter
```

The launcher copies this directory outside the checkout, installs published
`prefix-safe-json@0.5.3`, `@openrouter/agent@0.11.0`, `@openrouter/sdk@0.13.67`
and `zod@4.4.3`, then runs the assertions. Alternatively, copy this directory,
run `npm install --engine-strict --no-audit --no-fund`, then `npm start`.
No API key or live model call is needed: the HTTP transport is replaced with
authored, fragmented SSE fixtures. Effects are in-memory counters.

This extends the [single-response comparison](https://gist.github.com/canblmz1/2b31eaad54223249231b56442e2b1bae)
by checking the next request and final assistant response:

1. Declare the SDK tool with `execute: false`. The SDK owns no tool callback.
2. Tee the original response body. One branch goes to the SDK; the other goes
   through its exported `EventStream` decoder to PSJ's `OpenAIStreamAdapter`.
   The evidence branch reads to EOF, including events after `response.completed`.
3. Await both consumers and finalize the gate. Reject the whole batch if any
   call is denied or its identity is missing, duplicated or unmatched.
4. Consume each accepted call's authority once. Check all transcript arguments
   against those values before dispatching the harmless tools.
5. Append the SDK's original output and exactly one `function_call_output` per
   accepted call, using its `callId`. Run a second `callModel()` and verify the
   actual serialized request uses the correct `call_id` and result payloads.

The SDK's high-level `getFullResponsesStream()` ends at its terminal response
boundary in this installed version. Rebuilding events from its final tool
objects cannot restore later evidence. The example therefore observes the
original HTTP body instead of using that getter as its authority input.

| Authored scenario | Tool effects | Model requests |
| --- | ---: | ---: |
| Complete call; submit result; receive final answer | 1 | 2 |
| Same, using CRLF SSE framing | 1 | 2 |
| Two distinct calls; submit both results; receive final answer | 2 | 2 |
| Two items reuse one call ID | 0 | 1 |
| Valid JSON with `max_output_tokens` termination | 0 | 1 |
| Argument delta after the terminal response | 0 | 1 |
| One valid call and one schema-invalid sibling | 0 | 1 |
| Transport read failure after terminal bytes | 0 | 1 |

Blocked batches produce no follow-up request and no synthetic error results.
The whole-batch rule is caller policy in this example, not a new PSJ API.
It avoids executing a valid sibling before discovering another invalid call;
it does not provide transactional rollback if a dispatched handler later fails.
Keep permissions, semantic checks, durable result recording and crash recovery
in your application. One-shot gate authority is local to this gate instance,
not distributed idempotency across retries or conversation turns.

These selected client-parser checks do not certify live OpenRouter behavior or
arbitrary SDK versions. The SSE decoder ignores unterminated frames at EOF;
this example checks complete SSE frames and transport errors, not detection of
discarded partial frames. A provider that hides a failure behind a successful
terminal signal cannot be diagnosed from the remaining evidence. Production
transport interception also needs cancellation, bounded buffering and timeouts.
The example retains events for assertions and has no production memory bound.

OpenRouter Agent's current source already contains a native token-limit guard;
the original issue distinguishes that source fix from the published `0.11.0`
package. PSJ is optional. This example checks a caller-owned dispatch policy
and result correlation; it is not a claim that the dependency is necessary for
every OpenRouter application or that an independent maintainer adopted it.

[Report your own-project run or integration blocker](../../docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
