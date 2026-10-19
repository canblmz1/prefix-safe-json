import { asSchema, jsonSchema, streamText, type ToolSet } from "ai";
import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { canonical, GuardRefusal, guardResponse, inspectWire } from "./wire.js";
import type { GuardCapture } from "./recording-types.js";

export { GuardRefusal } from "./wire.js";
export type { GuardCapture } from "./recording-types.js";

export interface GuardEvent {
  readonly status: "allowed" | "refused";
  readonly toolCalls: number;
  readonly reason?: string;
}

export type GuardedChatSettings = Pick<OpenAICompatibleProviderSettings, "name" | "baseURL" | "apiKey" | "headers" | "queryParams" | "includeUsage" | "fetch"> & {
  /** Whole-response buffering ceiling; defaults to 8 MiB. */
  maxResponseBytes?: number;
  /** Display-only text/reasoning prefix streams by default. Tool bytes wait for EOF. */
  textStreaming?: "prefix" | "buffered";
  /** Local, payload-free callback. The package sends no telemetry. */
  onDecision?: (event: GuardEvent) => void;
  /** Explicit opt-in: contains original response bytes and wire tool schemas. */
  onCapture?: (capture: GuardCapture) => void | Promise<void>;
};

type NativeOptions<T extends ToolSet> = Parameters<typeof streamText<T>>[0];
const generation = ["temperature", "maxOutputTokens", "topP", "topK", "presencePenalty", "frequencyPenalty", "stopSequences", "seed", "reasoning"] as const;
const allowed = ["model", "tools", "prompt", "messages", "system", "instructions", "stopWhen", "abortSignal", ...generation, "toolChoice", "activeTools", "prepareStep", "providerOptions", "onError", "onChunk", "onFinish", "onStepFinish", "headers", "toolCallConcurrency", "timeout"] as const;
const stepAllowed = ["activeTools", "messages", "system", "instructions", "toolChoice", "providerOptions", ...generation] as const;
type NativePrepareStep<T extends ToolSet> = NonNullable<NativeOptions<T>["prepareStep"]>;
type NativeStepSettings<T extends ToolSet> = NonNullable<Awaited<ReturnType<NativePrepareStep<T>>>>;
export type GuardedStepSettings<T extends ToolSet> = Pick<NativeStepSettings<T>, typeof stepAllowed[number] & keyof NativeStepSettings<T>> & {
  model?: never; tools?: never; toolsContext?: never; runtimeContext?: never; experimental_sandbox?: never;
};
export type GuardedPrepareStep<T extends ToolSet> = (context: Parameters<NativePrepareStep<T>>[0]) =>
  GuardedStepSettings<T> | undefined | PromiseLike<GuardedStepSettings<T> | undefined>;
export type GuardedChatOptions<T extends ToolSet> = Pick<NativeOptions<T>, Exclude<typeof allowed[number], "model" | "tools" | "prompt" | "messages" | "prepareStep"> & keyof NativeOptions<T>> & { model: string; tools: T; prepareStep?: GuardedPrepareStep<T> } & (
  { prompt: NonNullable<NativeOptions<T>["prompt"]>; messages?: never } |
  { messages: NonNullable<NativeOptions<T>["messages"]>; prompt?: never }
);

interface Authority { name: string; input: string }
export type GuardedChatResult<T extends ToolSet> = Extract<ReturnType<typeof streamText<T>>, { readonly text: PromiseLike<string> }>;

/**
 * Experimental OpenAI-compatible Chat Completions integration. Checks each
 * original response before releasing tool-bearing bytes to native execution.
 * Normal tool results, stopWhen, stream results and UI responses remain SDK-owned.
 */
export function createGuardedChat(settings: GuardedChatSettings) {
  const settingsAllowed = ["name", "baseURL", "apiKey", "headers", "queryParams", "includeUsage", "fetch", "maxResponseBytes", "textStreaming", "onDecision", "onCapture"];
  for (const key of Object.keys(settings)) if (!settingsAllowed.includes(key)) throw new Error(`Unsupported guarded provider setting: ${key}. Check the supported provider settings before migrating.`);
  const limit = settings.maxResponseBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024 * 1024) throw new Error("maxResponseBytes must be 1..67108864.");
  if (settings.textStreaming !== undefined && !["prefix", "buffered"].includes(settings.textStreaming)) throw new Error("textStreaming must be prefix or buffered.");
  const upstream = settings.fetch ?? globalThis.fetch;
  return function guardedChat<const T extends ToolSet>(options: GuardedChatOptions<T>): GuardedChatResult<T> {
    for (const key of Object.keys(options)) if (!(allowed as readonly string[]).includes(key)) {
      throw new Error(`Unsupported guarded option: ${key}. Model/tool replacement, repair and input refinement require the caller-owned API.`);
    }
    if (typeof options.model !== "string" || !options.model) throw new Error("Supply an OpenAI-compatible chat model ID.");
    const authorities = new Map<string, Authority>();
    const approved = new Map<string, Set<string>>();
    const schemas = new Map<string, ReturnType<typeof asSchema>>();
    const wrapped = Object.create(null) as ToolSet;
    for (const [name, definition] of Object.entries(options.tools)) {
      if ((definition.type !== undefined && definition.type !== "function" && definition.type !== "dynamic") || typeof definition.execute !== "function" ||
          definition.onInputStart || definition.onInputDelta || definition.onInputAvailable || definition.needsApproval) {
        throw new Error(`Tool ${name} needs an ordinary execute function and no input hooks or approval continuation. Use the caller-owned API for other execution policies.`);
      }
      const schema = asSchema(definition.inputSchema);
      schemas.set(name, schema);
      approved.set(name, new Set());
      const execute = definition.execute;
      wrapped[name] = {
        ...definition,
        inputSchema: jsonSchema(() => schema.jsonSchema, { validate(value) {
          try {
            if (approved.get(name)?.has(canonical(value))) return { success: true, value: structuredClone(value) };
          } catch { /* A non-JSON projection is never executable. */ }
          return { success: false, error: new GuardRefusal("unverified_sdk_input") };
        } }),
        execute(input, context) {
          const authority = authorities.get(context.toolCallId);
          if (!authority || authority.name !== name || authority.input !== canonical(input)) throw new GuardRefusal("sdk_identity_or_input_mismatch");
          authorities.delete(context.toolCallId);
          context.abortSignal?.throwIfAborted();
          return execute(input, context);
        },
      };
    }
    const revoke = () => {
      authorities.clear();
      for (const values of approved.values()) values.clear();
    };
    const guardedFetch: typeof fetch = async (url, init) => {
      revoke();
      if (typeof init?.body !== "string") throw new GuardRefusal("unsupported_request_body");
      const request = JSON.parse(init.body) as { model?: unknown; stream?: unknown; tools?: { type?: string; function?: { name?: string; parameters?: object } }[] };
      if (request.model !== options.model) throw new GuardRefusal("model_mismatch");
      if (request.stream !== true) throw new GuardRefusal("non_stream_request");
      const wireSchemas: Record<string, object> = Object.create(null) as Record<string, object>;
      for (const tool of request.tools ?? []) {
        const name = tool.function?.name;
        if (tool.type !== "function" || !name || !schemas.has(name) || !tool.function?.parameters || Object.hasOwn(wireSchemas, name)) throw new GuardRefusal("unregistered_request_tool");
        wireSchemas[name] = tool.function.parameters;
      }
      const response = await upstream(url, init);
      if (!response.ok) return response;
      if (!/^text\/event-stream(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) {
        await response.body?.cancel().catch(() => {});
        settings.onDecision?.({ status: "refused", toolCalls: 0, reason: "unsupported_response_type" });
        throw new GuardRefusal("unsupported_response_type");
      }
      return guardResponse(response, {
        limit, signal: init.signal, buffered: settings.textStreaming === "buffered", revoke,
        decide: event => settings.onDecision?.(event),
        async observe(body, bodyComplete, decision) {
          if (!settings.onCapture) return;
          try {
            await settings.onCapture({ formatVersion: 1, protocol: "openai-chat-completions-sse", body: new Uint8Array(body),
              bodyComplete, toolSchemas: structuredClone(wireSchemas), decision: { ...decision } });
          } catch { throw new GuardRefusal("recording_error"); }
        },
        async validate(bytes) {
          const { gate, decisions } = inspectWire(bytes, wireSchemas);
          // Validate the ENTIRE batch with original application schemas before
          // the SDK sees any call. Retain only unchanged JSON; validation runs once.
          const pending: [string, Authority][] = [];
          for (const decision of decisions) {
            if (decision.action !== "execute" || !decision.toolCallId || !decision.name || !Object.hasOwn(wireSchemas, decision.name)) throw new GuardRefusal("unregistered_call");
            const schema = schemas.get(decision.name);
            const input = canonical(decision.value);
            if (schema?.validate) {
              const result = await schema.validate(structuredClone(decision.value));
              if (!result.success) throw new GuardRefusal("application_schema_invalid");
              if (canonical(result.value) !== input) throw new GuardRefusal("transformed_input");
            }
            init.signal?.throwIfAborted();
            const authority = gate.takeDecision(decision.internalId);
            if (!authority || pending.some(([id]) => id === decision.toolCallId)) throw new GuardRefusal("ambiguous_authority");
            pending.push([decision.toolCallId, { name: decision.name, input }]);
          }
          return { toolCalls: pending.length, commit() {
            for (const [id, authority] of pending) {
              authorities.set(id, authority);
              approved.get(authority.name)?.add(authority.input);
            }
          } };
        },
      });
    };
    const provider = createOpenAICompatible({ name: settings.name, baseURL: settings.baseURL, apiKey: settings.apiKey, headers: settings.headers,
      queryParams: settings.queryParams, includeUsage: settings.includeUsage, fetch: guardedFetch });
    const prepare = options.prepareStep;
    const prepareStep = prepare ? async (context: Parameters<NativePrepareStep<T>>[0]) => {
      // A new step cannot reuse unused authority from an earlier response.
      revoke();
      const result = await prepare(context);
      if (result === undefined) return undefined;
      if (!result || typeof result !== "object" || Array.isArray(result) ||
          ![Object.prototype, null].includes(Object.getPrototypeOf(result) as object | null)) throw new Error("prepareStep must return a plain settings object or undefined.");
      for (const key of Object.keys(result)) if (!(stepAllowed as readonly string[]).includes(key)) {
        throw new Error(`Unsupported prepareStep option: ${key}. Keep the configured model and registered tools; use activeTools to select tools per step.`);
      }
      // Strip prototype/non-enumerable fields and snapshot keys before the SDK
      // reads the settings. Model, tools and execution policy cannot be replaced.
      return { ...result };
    } : undefined;
    // The SDK conditionally intersects prepareStep with tool-context settings.
    // This wrapper preserves that input context and never returns replacements.
    return streamText<T>({ ...options, prepareStep: prepareStep as NativePrepareStep<T> | undefined, model: provider.chatModel(options.model), tools: wrapped as T, maxRetries: 0, experimental_lowMemory: false }) as GuardedChatResult<T>;
  };
}
