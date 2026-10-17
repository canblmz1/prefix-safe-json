# Typed, caller-owned agent loop

This example uses an Experimental API added in PSJ `0.6.0`.
It compiles strict TypeScript against the installed package, not repository
source imports. Node 22+ and npm are required. It needs no API key or model
server; the installed AI SDK uses authored model fixtures and memory counters.

From a current PSJ checkout, run `node scripts/try-npm-demo.mjs` (or pass
`typed` explicitly). It copies this example into a separate temporary
directory, installs its published dependencies and runs the five scenarios.

Download and extract the [0.6.0 example ZIP](https://github.com/canblmz1/prefix-safe-json/releases/download/v0.6.0/prefix-safe-json-0.6.0-typed-loop.zip),
or copy this directory outside the repository, then run:

```bash
npm install --engine-strict --no-audit --no-fund
npm start
```

To test an unpublished candidate, run from the PSJ repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm pack --out examples/typed-agent-loop/prefix-safe-json-candidate.tgz
npm --prefix examples/typed-agent-loop pkg set dependencies.prefix-safe-json=file:./prefix-safe-json-candidate.tgz
npm --prefix examples/typed-agent-loop install --engine-strict --no-audit --no-fund
npm --prefix examples/typed-agent-loop run check
npm --prefix examples/typed-agent-loop start
```

CI substitutes the actual tarball into an empty consumer directory
before installing. No workspace aliases or source imports are used.

| Scenario | Model requests | Successful effects | Result |
| --- | --- | --- | --- |
| Complete, distinct IDs | 2 | 2 | Both results reach the next request; final answer returned |
| Complete JSON, token-limit termination | 1 | 0 | Batch refused; no continuation |
| Duplicate call IDs | 1 | 0 | Batch refused; no continuation |
| Cancelled before generation | 0 | 0 | No request or tool execution |
| First tool throws | 1 | 0 | One attempt; no automatic retry or continuation |

`createTypedAiSdkExecutionGuard({ inputSchemas })` infers each authorized
tool's `name` and `value` from its Standard Schema output type. It compares
that output with the original JSON value before allowing authority, so
coercion, defaults, transforms and removed keys cannot silently give raw
arguments the transformed output's type. Object key order is irrelevant.
Use strict or passthrough Zod objects; asynchronous schemas are refused.
The existing `fromStandardSchema` adapter remains validation-only.

```typescript
import { z } from "zod";
import { createTypedAiSdkExecutionGuard } from "prefix-safe-json/standard-schema";

const inputSchema = z.object({ message: z.string() }).strict();
const guard = createTypedAiSdkExecutionGuard({
  inputSchemas: { record_message: inputSchema },
});
// Feed one request's fullStream, then finish before taking any decision.
for (const observed of guard.finish().decisions) {
  const authority = guard.takeDecision(observed.internalId);
  if (authority) {
    // authority.name is "record_message" and value.message is string.
    console.log(authority.value.message);
  }
}
```

To connect a real model, replace the `MockLanguageModelV4` fixture with your
model, replace the memory handler with your tool implementation, and retain
the request-scoped guard and caller-owned loop. Drain each stream before
consuming authority. Append the response's assistant messages and each
authorized call's result with its original `toolCallId` before the next
request. Never substitute the SDK's parsed input for `authority.value`.

The example checks authority for the whole batch before starting any tool.
That is an application policy, not a rollback transaction: a later tool may
fail after earlier effects succeeded. A consumed decision cannot be reused;
real retry/idempotency policies and error reporting belong to the caller.
Tools here are local; provider-executed tools are outside this boundary.

The five scenarios do not certify a live provider, production deployment,
UI approval workflow or independent adoption. The loop stops after at most
three requests and never automatically continues a rejected batch.
