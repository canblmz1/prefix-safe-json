# Native SDK callbacks with original-response checks

Run `node scripts/try-npm-demo.mjs` from a PSJ checkout, or copy this directory
outside the repository and run `npm install --ignore-scripts && npm start`.
Node 22+ is required. The preview is a separate GitHub tarball; core PSJ remains
the published `0.6.1` package.

The offline provider supplies authored HTTP/SSE bytes to the installed real
OpenAI-compatible parser. Ordinary `execute` callbacks run in the native SDK.
The complete case checks both outgoing result IDs, a second model request and
the final answer. Duplicate wire IDs, output-limit termination and an invalid
sibling produce zero callbacks and no continuation.

No API key, model, filesystem tool or application-owned dispatch loop is used.
The fixture transport is test setup, not integration code to copy into a live
application. Use [the package quick start](../../packages/ai-sdk/README.md) with
your own configured endpoint and tools.

The 0.2 integration streams a display-only text/reasoning prefix. Tool calls
and all bytes following them wait for EOF and whole-batch validation. Text is
provisional; handle body errors when consuming it. Its function-tool policy is narrower than the SDK's full
API; input hooks, approval continuation and model/tool replacement are refused.
The SDK remains responsible for tool errors and continuation. This is not
rollback, durable idempotency or evidence of independent adoption.
