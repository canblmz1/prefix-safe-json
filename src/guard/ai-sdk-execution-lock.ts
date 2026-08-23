/**
 * @public (Experimental)
 *
 * Structural execution lock for the Vercel AI SDK's tool-approval mechanism
 * (`needsApproval`, shipped in `ai@6`). Wrapping a tool definition with
 * {@link createAiSdkExecutionLock} makes it impossible for the AI SDK's own
 * tool loop to invoke that tool's real handler - not "discouraged", not
 * "detected after the fact", but structurally excluded from the SDK's own
 * execution set before `execute` is ever reached. See
 * `docs/EXECUTION_GATE.md#execution-ownership-tool-resulttool-error-as-evidence`
 * for why that distinction matters and what this does and does not close.
 *
 * ## What this does
 *
 * For every tool passed in:
 *   - any `execute` field the caller supplied is dropped, not carried
 *     through - there is nothing left for the SDK to call even if some other
 *     code path tried to.
 *   - `needsApproval` is forced to `true`, unconditionally. This library
 *     never wires up a `toolApproval` resolver (the SDK parameter that would
 *     grant approval) alongside it, so on an SDK version that honors
 *     `needsApproval`, every call to a locked tool permanently stays in the
 *     `"user-approval"` state for that `generateText`/`streamText` call: the
 *     SDK emits a `tool-approval-request` stream part and *provably* never
 *     calls `execute` (verified directly against `ai@6`/`ai@7`'s own
 *     `executeToolsFromStream` source: a blocked/pending toolCallId is never
 *     added to the set passed to the real execution step).
 *
 * Real execution stays exactly where it already was: the caller drives it
 * manually from `guard.finish().decisions`, using the value the gate itself
 * authorized from raw evidence - not `chunk.input`, not anything the SDK
 * derived. This function does not execute anything, queue anything, or
 * introduce a placeholder result; there is no new reconciliation problem to
 * solve because nothing fake is ever produced for the SDK to hand back to
 * the model.
 *
 * ## What this does NOT do
 *
 * `needsApproval` does not exist before `ai@6` (verified directly against
 * `ai@5`'s published type declarations: no `needsApproval`, no
 * `tool-approval-request`, no `experimental_toolApprovalSecret` anywhere).
 * On `ai@5`, the `needsApproval: true` field this function adds is simply
 * ignored - but this function *also* unconditionally drops whatever
 * `execute` the caller passed in, on every major, and that half keeps
 * working even where `needsApproval` doesn't exist: a tool this function
 * returns has no `execute` field at all on `ai@5` either, so there is
 * nothing there for the SDK to call (verified directly: see
 * `test/integration/ai-sdk-lifecycle/ai-v5.real.test.ts`). What this
 * function structurally *cannot* protect against, on any major, is a tool
 * definition that never went through it at all - a caller who attaches
 * `execute` directly instead of calling this function first gets no
 * protection here, and on `ai@5` specifically that native `execute` fires
 * exactly as unprotected as it always has (same test file proves this too).
 * The existing `sdk_execution_observed` detection (`AiSdkStreamAdapter`'s
 * `"tool-result"`/`"tool-error"` handling) remains the real backstop for
 * that bypass case, on every major - it fires correctly whether or not this
 * lock was used, exactly as it did before this function existed.
 *
 * @example
 * ```ts
 * const result = streamText({
 *   model,
 *   tools: createAiSdkExecutionLock({
 *     write_file: { description: "...", inputSchema: schema },
 *   }),
 * });
 *
 * const guard = createAiSdkExecutionGuard({ schemas: { write_file: jsonSchema } });
 * for await (const part of result.fullStream) guard.push(part);
 * for (const decision of guard.finish().decisions) {
 *   if (decision.action === "execute") await realWriteFile(decision.value);
 * }
 * ```
 */
export function createAiSdkExecutionLock<TTools extends Record<string, object>>(tools: TTools): TTools {
  const locked: Record<string, object> = {};
  for (const [name, definition] of Object.entries(tools)) {
    const { execute: _droppedExecute, ...rest } = definition as { execute?: unknown; [key: string]: unknown };
    locked[name] = { ...rest, needsApproval: true };
  }
  return locked as TTools;
}
