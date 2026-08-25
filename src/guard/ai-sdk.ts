import { AiSdkStreamAdapter } from "../providers/ai-sdk.js";
import { createProviderExecutionGuard } from "./provider-guard.js";
import { AiSdkExecutionGuard, ExecutionGuardOptions } from "./types.js";

/**
 * @public (Stable)
 * Drop-in fail-closed execution guard for the Vercel AI SDK's `fullStream`.
 * Composes `AiSdkStreamAdapter` with `createToolCallExecutionGate()` - same
 * decision logic, same fail-closed guarantees, no new parser or coordinator.
 * Does not depend on the `ai` package at runtime and does not import its
 * types; `push()` accepts `unknown` and reads only the fields it needs.
 *
 * ```ts
 * const guard = createAiSdkExecutionGuard({
 *   schemas: {
 *     write_file: {
 *       type: "object",
 *       properties: { path: { type: "string" }, content: { type: "string" } },
 *       required: ["path", "content"],
 *     },
 *   },
 * });
 *
 * for await (const part of result.fullStream) {
 *   guard.push(part);
 * }
 *
 * const final = guard.finish();
 * for (const observed of final.decisions) {
 *   const authority = guard.takeDecision(observed.internalId);
 *   if (authority) await tools[authority.name](authority.value);
 * }
 * ```
 *
 * Equivalent to composing the low-level API yourself:
 *
 * ```ts
 * const gate = createToolCallExecutionGate(undefined, undefined, schemas);
 * const adapter = new AiSdkStreamAdapter();
 * for await (const part of result.fullStream) {
 *   for (const normalized of adapter.push(part)) gate.push(normalized);
 * }
 * const final = gate.finish();
 * ```
 *
 * Both APIs remain public; use this one for the common case, the low-level
 * one when you need direct access to the adapter or gate instance.
 */
export function createAiSdkExecutionGuard(options?: ExecutionGuardOptions): AiSdkExecutionGuard {
  return createProviderExecutionGuard(new AiSdkStreamAdapter(), options);
}
