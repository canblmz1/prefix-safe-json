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
 * executes). Also rejects a function-valued `description` (see "Function-
 * valued description" below) and provider tool shapes whose real execution
 * location this function cannot verify (see "Provider-executed and
 * execution-location-ambiguous tools" below).
 *
 * ## The guarantee, precisely
 *
 * For a **supported local tool definition** (see the two rejection sections
 * below for what this excludes) returned by this function and passed
 * **unchanged** to `streamText`/`generateText`: none of `execute`,
 * `onInputStart`, `onInputDelta`, or `onInputAvailable` can run before this
 * library's gate reaches a decision, because none of them exist on the
 * object the SDK receives - there is no code path left that could reach
 * them, on any of `ai@5`/`ai@6`/`ai@7`. This is a claim about *this
 * function's own output*, not a sandbox: it says nothing about a tool
 * definition that never went through this function, one reconstructed or
 * mutated after this function returns it, or a rejected shape. Real
 * execution stays exactly where it already was: driven manually from
 * one-shot `guard.takeDecision()`, using the value the gate itself authorized
 * from raw evidence - not `chunk.input`, not anything the SDK derived. This
 * function does not execute anything, queue anything, or introduce a
 * placeholder result.
 *
 * ## Function-valued description (ai@7+)
 *
 * `ai@5`/`ai@6` type `description` as `string` only. `ai@7` additionally
 * allows a function - verified directly against `ai@7.0.77`'s own real
 * source (not published types) that `prepareTools()` calls
 * `resolveToolDescription()`, which invokes that function during tool
 * preparation, *before* `streamText`/`generateText`'s model call begins and
 * therefore necessarily before this library's gate can reach any decision.
 * A function-valued `description` is arbitrary caller code running on this
 * same pre-decision timeline as the callback trio above, so this function
 * rejects it rather than silently passing it through under `...rest`. A
 * string `description` is unaffected on every major.
 *
 * ## Provider-executed and execution-location-ambiguous tools
 *
 * A locked tool's real execution location is only ever verifiable when the
 * object shape itself proves it, checked per-major against each major's own
 * real source, not inferred from a package-name/version string:
 *
 * - **`isProviderExecuted: true`** (any major that sets it, chiefly `ai@7`):
 *   the AI SDK's own discriminant for "this tool's real operation runs
 *   entirely on the model provider's remote infrastructure" - web search,
 *   code execution, etc. Outside what any local wrapper can affect - there
 *   is no local `execute` for this function to remove in the first place,
 *   because the side effect never happens in this process at all. **Rejected.**
 * - **`ai@7`'s `{ type: "provider", isProviderExecuted: false }`** (a
 *   provider-defined-but-locally-executed tool, e.g. a local shell tool with
 *   a provider-defined schema): verified against `ai@7.0.77`'s own real
 *   source that this shape structurally has no `execute` field at all (it is
 *   not part of the type), so the SDK's own `isExecutableTool()` check
 *   (`typeof tool.execute === "function"`) never auto-runs it - the same
 *   "no `execute` means never auto-executed" rule an ordinary tool follows.
 *   **Accepted**, and passed through the same strip-and-relock path as any
 *   other tool (so a stray `onInputStart`/`onInputDelta`/`onInputAvailable`
 *   is still removed).
 * - **`ai@6`'s `{ type: "provider" }`** (any `isProviderExecuted` value other
 *   than `false`, including absent): verified against `ai@6.0.264`'s own
 *   real type declarations that this major's provider-tool shape has *no*
 *   `isProviderExecuted` discriminator at all - `ai@7` added it for exactly
 *   this reason. This function cannot safely infer local-vs-remote from the
 *   shape alone. **Rejected as ambiguous**, not silently accepted.
 * - **`ai@5`'s `{ type: "provider-defined" }`**: verified against
 *   `ai@5.0.244`'s own real type declarations that this major's
 *   provider-tool shape also has no execution-location discriminator - some
 *   provider-defined tools execute locally, some remotely, and nothing in
 *   the object distinguishes them. **Rejected as ambiguous.**
 *
 * Every rejection here throws rather than returning an object that would
 * falsely imply this function had made a guarantee it cannot verify.
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
 * This function is **not a general sandbox for arbitrary side effects**
 * hidden inside a tool definition's *other* fields. In particular, a JSON
 * Schema library's own validation/refinement/transform machinery, a getter,
 * or a Proxy attached to `inputSchema` (or any field this function preserves
 * unchanged via `...rest`) is caller-provided executable code that this
 * function has no visibility into and does not run, remove, or guard - a
 * schema used inside this security boundary must itself be side-effect
 * free. This is a threat-model boundary, not a reason to drop schema
 * support: the only fields this function ever removes are the five it
 * documents removing above.
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
 * const final = guard.finish();
 * for (const observed of final.decisions) {
 *   const authority = guard.takeDecision(observed.internalId);
 *   if (authority) await realWriteFile(authority.value);
 * }
 * ```
 */
type ShapeProbe = {
  type?: unknown;
  isProviderExecuted?: unknown;
  description?: unknown;
  execute?: unknown;
  onInputStart?: unknown;
  onInputDelta?: unknown;
  onInputAvailable?: unknown;
  needsApproval?: unknown;
  [key: string]: unknown;
};

/**
 * Rejects tool shapes whose real execution location this function cannot
 * verify from the object alone. See the "Provider-executed and
 * execution-location-ambiguous tools" section of this module's top doc
 * comment for the exact per-major reasoning; this function only encodes the
 * resulting decision table.
 */
function rejectUnsupportedProviderShape(name: string, definition: ShapeProbe): void {
  if (definition.isProviderExecuted === true) {
    throw new Error(
      `createAiSdkExecutionLock: tool "${name}" is provider-executed (isProviderExecuted: true) - ` +
        "its real operation runs entirely on the model provider's own infrastructure, which this " +
        "function has no visibility into or control over. Wrapping it here would falsely imply a " +
        "guarantee this function cannot make. Do not pass provider-executed tools to this function.",
    );
  }

  if (definition.type === "provider") {
    if (definition.isProviderExecuted === false) {
      // ai@7's locally-executed provider-defined shape - see the doc comment;
      // structurally has no `execute` field, so the SDK's own
      // `isExecutableTool` (`typeof tool.execute === "function"`) never
      // auto-runs it, and it falls through to the normal strip-and-relock
      // path below like any other accepted tool.
      return;
    }
    throw new Error(
      `createAiSdkExecutionLock: tool "${name}" has type "provider" but no isProviderExecuted flag - ` +
        "this matches ai@6's provider-tool shape, which has no discriminator at all for whether the " +
        "operation runs on the model provider's remote infrastructure or locally in this process " +
        "(ai@7 added isProviderExecuted for exactly this reason). This function cannot safely infer " +
        "which applies from the object shape, so it rejects rather than risk falsely implying a " +
        "guarantee it cannot verify. Do not pass this tool to createAiSdkExecutionLock.",
    );
  }

  if (definition.type === "provider-defined") {
    throw new Error(
      `createAiSdkExecutionLock: tool "${name}" has type "provider-defined" - this is ai@5's ` +
        "provider-tool shape, which (like ai@6's) has no isProviderExecuted or equivalent " +
        "discriminator: some provider-defined tools execute locally and some execute entirely on " +
        "the provider's remote infrastructure, and nothing in the object shape distinguishes them. " +
        "This function cannot safely infer which execution authority applies, so it rejects rather " +
        "than guess. Do not pass this tool to createAiSdkExecutionLock.",
    );
  }
}

/**
 * Rejects a function-valued `description`. On ai@7, `prepareTools()` calls
 * `resolveToolDescription()`, which invokes a function-valued `description`
 * directly - arbitrary caller code running during tool preparation, before
 * `streamText`/`generateText`'s model call begins and therefore necessarily
 * before this library's gate can reach any decision. ai@5/ai@6 only ever
 * typed `description` as `string`, so this rejects nothing for a caller
 * following those majors' own types; it is a shape check, not a version
 * check, and applies identically regardless of which major is installed.
 */
function rejectFunctionValuedDescription(name: string, definition: ShapeProbe): void {
  if (typeof definition.description !== "function") return;
  throw new Error(
    `createAiSdkExecutionLock: tool "${name}" has a function-valued "description" - ` +
      "on ai@7+, the AI SDK's own prepareTools()/resolveToolDescription() calls that function " +
      "during tool preparation, before streamText/generateText's model call begins, which is " +
      "arbitrary caller code running before this library's gate can reach any decision. A string " +
      "description is unaffected and remains supported. Do not pass a function-valued description " +
      "to createAiSdkExecutionLock; resolve it to a string yourself before calling this function.",
  );
}

export function createAiSdkExecutionLock<TTools extends Record<string, object>>(tools: TTools): LockedAiSdkTools<TTools> {
  const locked: Record<string, object> = {};
  for (const [name, definition] of Object.entries(tools)) {
    const probe = definition as ShapeProbe;
    rejectUnsupportedProviderShape(name, probe);
    if (probe.type !== "provider") {
      // Only the ordinary local-tool code path (type undefined/"function"/"dynamic")
      // ever reaches prepareTools()'s description-invoking branch; an accepted
      // `type: "provider"` tool's description is never read by the SDK at all
      // (see rejectUnsupportedProviderShape's "provider" branch), so checking
      // it there would reject shapes the SDK can never actually exploit.
      rejectFunctionValuedDescription(name, probe);
    }
    const {
      execute: _droppedExecute,
      onInputStart: _droppedOnInputStart,
      onInputDelta: _droppedOnInputDelta,
      onInputAvailable: _droppedOnInputAvailable,
      needsApproval: _droppedNeedsApproval,
      ...rest
    } = probe;
    locked[name] = { ...rest, needsApproval: true };
  }
  return locked as LockedAiSdkTools<TTools>;
}
