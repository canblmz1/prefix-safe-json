# TanStack AI / OpenRouter: raw evidence at the server-tool boundary

The [verified native-first source trial](https://gist.github.com/canblmz1/ba1e62d792da37d3f420c328f56d81be)
includes a locally built PSJ candidate and works without an npm release of
that candidate. The installed-package commands below require published
`prefix-safe-json@0.5.4`.

With Node 22+ and npm, run from the repository checkout:

```bash
node scripts/try-npm-demo.mjs tanstack
```

The launcher copies this directory to a retained temporary project and installs
`prefix-safe-json@0.5.4`, `@tanstack/ai@0.69.0`,
`@tanstack/ai-openrouter@0.22.0`, `@openrouter/sdk@0.13.20` and Zod `4.6.5`.
Alternatively, copy this directory outside the checkout, run
`npm install --engine-strict --no-audit --no-fund`, then `npm start`.
The HTTP client is entirely replaced with authored, fragmented SSE fixtures.
No API key or live model call is needed; the SQL-shaped input is only recorded
in memory and never sent to a database.
The native malformed-input case prints expected parser-error diagnostics;
the assertions and process exit status determine whether the trial passed.

The native path runs real TanStack `chat()` with a server tool. The guarded
path tees the same original HTTP body, feeds decoded raw events into
`OpenRouterStreamAdapter`, and awaits that evidence consumer from inside the
server-tool wrapper before any effect. The wrapper checks the actual execution
context's `toolCallId`, consumes gate authority once, and uses its value rather
than the SDK's parsed arguments. SDK callback invocation alone does not mean
the guarded effect happened.

| Authored scenario | Native effects | Guarded effects |
| --- | ---: | ---: |
| Complete JSON and normal usage trailer | 1 | 1 |
| Malformed JSON, native token limit and usage trailer | 1 | 0 |
| Complete JSON, native token limit and usage trailer | 1 | 0 |
| Complete JSON, native token limit without usage trailer | 1 | 0 |
| Complete JSON, normalized `length` termination | 1 | 0 |

Each path completes two model requests. Blocked handlers throw before the
counter changes; TanStack sends one paired error result to the next request.
Assertions check that exactly one result uses the original `tool_call_id`.
Successful controls return the harmless recorded result. This recipe checks
one call per response, not duplicate-ID batches or arbitrary agent workflows.

The external [TanStack report](https://github.com/TanStack/ai/issues/1689)
describes the malformed-input fallback. The same behavior was checked in
published `0.22.0`, while the [pinned current source](https://github.com/TanStack/ai/blob/85c2956c68f3226ef409b3a4e54d5be82198931e/packages/ai-openrouter/src/adapters/text.ts#L1186)
already removes that fallback. Its full main branch was not built or run here.
That native correction remains useful independently of PSJ. The complete-JSON
and no-usage cases are authored extensions, not reports about production
frequency. PSJ's own `0.5.3` also mishandles native output-limit metadata and
normal usage trailers; this recipe requires the corrections in `0.5.4`.

OpenRouter documents both the [raw native finish reason](https://github.com/OpenRouterTeam/docs/blob/c6d74754eefd40a9acb9ba6c9fe86683745106ae/api_reference/overview.mdx)
and the [repeated terminal in the final usage chunk](https://github.com/OpenRouterTeam/docs/blob/c6d74754eefd40a9acb9ba6c9fe86683745106ae/api_reference/streaming.mdx).
The evidence decoder reads to EOF, including complete frames after `[DONE]`;
it does not recover unterminated SSE frames that the decoder discards.

This selected mock-transport check is not live-provider certification or
independent adoption. Production transport interception needs cancellation,
bounded buffering and timeouts. Keep authorization, semantic validation,
durable result recording and crash recovery in your application. Do not
reconstruct raw events from parsed tool objects; one-shot gate authority
does not provide distributed idempotency or undo a failed handler's effects.

[Report your own-project run or integration blocker](../../docs/TRY_IN_YOUR_PROJECT.md#report-a-result-or-request-help).
