# Native SDK callbacks with original-response checks

Run `node scripts/try-npm-demo.mjs` from a PSJ checkout, or copy this directory
outside the repository and run `npm install --ignore-scripts && npm start`.
Node 22+ is required. The companion and core are separate npm packages pinned
to `0.3.2` and `0.6.2`. For prepublication review, use the two
prepared tarballs from the [evaluation kit](../../docs/COMPANION_EVALUATION.md).

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
The 0.3 preview accepts ordinary generation settings and a limited `prepareStep`
for selecting registered tools and messages; see the package's supported subset.
The SDK remains responsible for tool errors and continuation. This is not
rollback, durable idempotency or evidence of independent adoption.

Run `npm run compare` for the same response through current native SDK,
a small application-native batch check, and the companion. The pinned
AI SDK/provider pair is `7.0.143`/`3.0.71`; native JSON/schema/finish checks are
included as controls. See the [evaluation kit](../../docs/COMPANION_EVALUATION.md)
for candidate-artifact installation, observed callback counts, integration
costs and independent keep/remove questions. The whole-batch diagnostic fix
requires companion 0.3.2; older previews do not include it.
