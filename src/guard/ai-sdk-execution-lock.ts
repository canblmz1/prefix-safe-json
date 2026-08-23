/**
 * A tool definition after {@link createAiSdkExecutionLock} has processed it.
 * `execute` and every SDK-invoked pre-decision input-lifecycle callback
 * (`onInputStart`, `onInputDelta`, `onInputAvailable`) are removed, not
 * merely typed as optional-and-absent - the compiler will reject an attempt
 * to read them off a locked tool. `needsApproval` is narrowed to the literal
 * `true`, reflecting that this function always forces it and never leaves it
 * caller-controlled. Every other field (schema, description, provider
 * metadata, etc.) keeps its original type unchanged.
 */
export type LockedAiSdkTool<T> = Omit<T, "execute" | "onInputStart" | "onInputDelta" | "onInputAvailable" | "needsApproval"> & {
  needsApproval: true;
};

/** `createAiSdkExecutionLock`'s return type: every tool in the input, individually locked. */
export type LockedAiSdkTools<TTools extends Record<string, object>> = {
  [K in keyof TTools]: LockedAiSdkTool<TTools[K]>;
};

/**
 * @public (Experimental)
 *
 * Removes every AI SDK-invoked callback field capable of running caller code
 * before this library's gate reaches a decision - `execute`, and also
 * `onInputStart`/`onInputDelta`/`onInputAvailable` (see "What this does NOT
 * do" in the previous version of this doc comment for why the callback trio
 * matters: verified directly against `ai@5`/`ai@6`/`ai@7`'s own real source,
 * not their published types, that all three fire in a transform stream
 * (`invokeToolCallbacksFromStream`) entirely separate from - and with zero
 * reference to - `needsApproval`/tool-approval resolution. `needsApproval:
 * true` alone, the previous version of this function, did NOT stop them:
 * `onInputAvailable`'s own doc comment even says it "is called when a tool
 * call can be started, even if the execute function is not provided" -
 * textual confirmation this is intentional SDK behavior, not a bug this
 * library is working around). Also forces `needsApproval: true`
 * unconditionally, which still closes the `execute` gap itself on `ai@6`+
 * exactly as before (verified against `ai@6`/`ai@7`'s own
 * `executeToolsFromStream`/`resolveToolApproval` source: a pending-approval
 * `toolCallId` is never added to the set of calls the SDK actually
 * executes).
 *
 * ## The guarantee, precisely
 *
 * For a **local, user-defined tool definition** (see "Provider-executed
 * tools" below for what this excludes) returned by this function and passed
 * **unchanged** to `streamText`/`generateText`: none of `execute`,
 * `onInputStart`, `onInputDelta`, or `onInputAvailable` can run before this
 * library's gate reaches a decision, because none of them exist on the
 * object the SDK receives - there is no code path left that could reach
 * them, on any of `ai@5`/`ai@6`/`ai@7`. This is a claim about *this
 * function's own output*, not a sandbox: it says nothing about a tool
 * definition that never went through this function, one reconstructed or
 * mutated after this function returns it, or a provider-executed tool.
 * Real execution stays exactly where it already was: driven manually from
 * `guard.finish().decisions`, using the value the gate itself authorized
 * from raw evidence - not `chunk.input`, not anything the SDK derived. This
 * function does not execute anything, queue anything, or introduce a
 * placeholder result.
 *
 * ## Provider-executed tools are rejected, not silently accepted
 *
 * A tool with `isProviderExecuted: true` (the AI SDK's own discriminant for
 * "this tool's real operation runs entirely on the model provider's remote
 * infrastructure" - web search, code execution, etc.) is outside what any
 * local wrapper can affect: there is no local `execute` for this function to
 * remove in the first place, because the side effect never happens in this
 * process at all. Passing one throws, rather than returning an object that
 * would falsely imply this function had done something to it.
 *
 * ## What this does NOT do
 *
 * `needsApproval` does not exist before `ai@6` (verified directly against
 * `ai@5`'s published type declarations: no `needsApproval`, no
 * `tool-approval-request`, no `experimental_toolApprovalSecret` anywhere) -
 * the forced-`true` half of this function is a harmless no-op there. Its
 * callback-stripping half still applies on every major, including `ai@5`
 * (verified: see `test/integration/ai-sdk-lifecycle/ai-v5.real.test.ts`).
 * What this function structurally *cannot* protect against, on any major, is
 * a tool definition that never went through it at all - a caller who
 * attaches `execute`/`onInputStart`/`onInputDelta`/`onInputAvailable`
 * directly instead of calling this function first gets no protection here.
 * The existing `sdk_execution_observed` detection (`AiSdkStreamAdapter`'s
 * `"tool-result"`/`"tool-error"` handling) remains the real backstop for a
 * bypassed/unwrapped `execute` specifically - it has no equivalent detection
 * for a bypassed `onInputStart`/`onInputDelta`/`onInputAvailable`, since
 * those callbacks produce no observable `fullStream` evidence of having run
 * at all.
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
export function createAiSdkExecutionLock<TTools extends Record<string, object>>(tools: TTools): LockedAiSdkTools<TTools> {
  const locked: Record<string, object> = {};
  for (const [name, definition] of Object.entries(tools)) {
    if ((definition as { isProviderExecuted?: unknown }).isProviderExecuted === true) {
      throw new Error(
        `createAiSdkExecutionLock: tool "${name}" is provider-executed (isProviderExecuted: true) - ` +
          "its real operation runs entirely on the model provider's own infrastructure, which this " +
          "function has no visibility into or control over. Wrapping it here would falsely imply a " +
          "guarantee this function cannot make. Do not pass provider-executed tools to this function.",
      );
    }
    const {
      execute: _droppedExecute,
      onInputStart: _droppedOnInputStart,
      onInputDelta: _droppedOnInputDelta,
      onInputAvailable: _droppedOnInputAvailable,
      needsApproval: _droppedNeedsApproval,
      ...rest
    } = definition as {
      execute?: unknown;
      onInputStart?: unknown;
      onInputDelta?: unknown;
      onInputAvailable?: unknown;
      needsApproval?: unknown;
      [key: string]: unknown;
    };
    locked[name] = { ...rest, needsApproval: true };
  }
  return locked as LockedAiSdkTools<TTools>;
}
