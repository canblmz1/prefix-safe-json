# Anthropic installed-package trial

With Node 22+ and npm, run from the repository checkout:

```bash
node scripts/try-npm-demo.mjs anthropic
```

The launcher copies this demo into a new temporary directory outside the
checkout, installs published `prefix-safe-json@0.5.2` and the official
`@anthropic-ai/sdk@0.123.0`, prints their versions, and runs the assertions.
It needs no API key or repository toolchain. Alternatively, copy this directory
outside the checkout and run `npm install --engine-strict`, then `npm start`.

The installed SDK's `messages.create({ stream: true })` parses fragmented mock
SSE. Its original event objects feed PSJ unchanged. Only the caller's in-memory
dispatch consumes `takeDecision().value`, after fully draining the SDK stream.

| Scenario | Expected effects |
| --- | --- |
| Complete JSON, `tool_use`, and `message_stop` | 1 |
| Mid-string JSON cutoff, `max_tokens`, and `message_stop` | 0 |
| Complete JSON, `max_tokens`, and `message_stop` | 0 |
| Complete JSON and `tool_use`, then EOF without `message_stop` | 0 |
| Complete call followed by a late argument delta after `message_stop` | 0 |

Each call's authority can be consumed at most once. A block closing or JSON
parsing successfully does not authorize execution by itself.

For your own project, keep the original SDK events at this boundary and start
with a harmless counter. Retain your application's permission and approval
checks before any real side effect. Do not reconstruct raw arguments from a
parsed final message, infer completion at EOF, or dispatch on intermediate
snapshots. If stream consumption throws, do not dispatch the unfinished call.

This is a mock-transport consumer check. Live-provider behavior, application
retries, and a framework's automatic execution are not tested. Native Ollama
and third-party gateways are not covered by this recipe.

[Report your own project result or blocker](../../docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
