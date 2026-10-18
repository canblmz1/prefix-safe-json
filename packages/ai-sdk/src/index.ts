import { asSchema, jsonSchema, streamText, type ToolSet } from "ai";
import { createOpenAICompatible, type OpenAICompatibleProviderSettings } from "@ai-sdk/openai-compatible";
import { canonical, GuardRefusal, inspectWire, readBounded } from "./wire.js";

export { GuardRefusal } from "./wire.js";

export interface GuardEvent {
  readonly status: "allowed" | "refused";
  readonly toolCalls: number;
  readonly reason?: string;
}

export type GuardedChatSettings = Pick<OpenAICompatibleProviderSettings, "name" | "baseURL" | "apiKey" | "headers" | "fetch"> & {
  /** Whole-response buffering ceiling; defaults to 8 MiB. */
  maxResponseBytes?: number;
  /** Local, payload-free callback. The package sends no telemetry. */
  onDecision?: (event: GuardEvent) => void;
};

type NativeOptions<T extends ToolSet> = Parameters<typeof streamText<T>>[0];
const allowed = ["model", "tools", "prompt", "messages", "system", "stopWhen", "abortSignal", "temperature", "maxOutputTokens", "toolChoice", "activeTools", "onError", "onChunk", "onFinish", "headers", "toolCallConcurrency", "timeout"] as const;
export type GuardedChatOptions<T extends ToolSet> = Pick<NativeOptions<T>, Exclude<typeof allowed[number], "model" | "tools" | "prompt" | "messages"> & keyof NativeOptions<T>> & { model: string; tools: T } & (
  { prompt: NonNullable<NativeOptions<T>["prompt"]>; messages?: never } |
  { messages: NonNullable<NativeOptions<T>["messages"]>; prompt?: never }
);

interface Authority { name: string; input: string }
export type GuardedChatResult<T extends ToolSet> = Extract<ReturnType<typeof streamText<T>>, { readonly text: PromiseLike<string> }>;

/**
 * Experimental OpenAI-compatible Chat Completions integration. Checks each
 * original response before releasing its bytes to native SDK tool execution.
 * Normal tool results, stopWhen, stream results and UI responses remain SDK-owned.
 */
export function createGuardedChat(settings: GuardedChatSettings) {
  const limit = settings.maxResponseBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 64 * 1024 * 1024) throw new Error("maxResponseBytes must be 1..67108864.");
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
      if ((definition.type !== undefined && definition.type !== "function") || typeof definition.execute !== "function" ||
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
    const guardedFetch: typeof fetch = async (url, init) => {
      authorities.clear();
      for (const values of approved.values()) values.clear();
      if (typeof init?.body !== "string") throw new GuardRefusal("unsupported_request_body");
      const request = JSON.parse(init.body) as { stream?: unknown; tools?: { type?: string; function?: { name?: string; parameters?: object } }[] };
      if (request.stream !== true) throw new GuardRefusal("non_stream_request");
      const wireSchemas: Record<string, object> = Object.create(null) as Record<string, object>;
      for (const tool of request.tools ?? []) {
        const name = tool.function?.name;
        if (tool.type !== "function" || !name || !schemas.has(name) || !tool.function?.parameters || Object.hasOwn(wireSchemas, name)) throw new GuardRefusal("unregistered_request_tool");
        wireSchemas[name] = tool.function.parameters;
      }
      const response = await upstream(url, init);
      if (!response.ok) return response;
      try {
        if (!/^text\/event-stream(?:;|$)/iu.test(response.headers.get("content-type") ?? "")) throw new GuardRefusal("unsupported_response_type");
        const bytes = await readBounded(response, limit, init.signal);
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
        for (const [id, authority] of pending) {
          authorities.set(id, authority);
          approved.get(authority.name)?.add(authority.input);
        }
        settings.onDecision?.({ status: "allowed", toolCalls: pending.length });
        // Bytes are unchanged; only transfer-specific headers become invalid
        // after fetch decompression and rebuilding this buffered response.
        const headers = new Headers(response.headers);
        for (const key of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(key);
        return new Response(new Uint8Array(bytes).buffer, { status: response.status, statusText: response.statusText, headers });
      } catch (error) {
        authorities.clear();
        for (const values of approved.values()) values.clear();
        await response.body?.cancel().catch(() => {});
        settings.onDecision?.({ status: "refused", toolCalls: 0, reason: error instanceof GuardRefusal ? error.reason : init.signal?.aborted ? "aborted" : "validation_error" });
        throw error instanceof GuardRefusal || init.signal?.aborted ? error : new GuardRefusal("validation_error");
      }
    };
    const provider = createOpenAICompatible({ name: settings.name, baseURL: settings.baseURL, apiKey: settings.apiKey, headers: settings.headers, fetch: guardedFetch });
    return streamText<T>({ ...options, model: provider.chatModel(options.model), tools: wrapped as T, maxRetries: 0, experimental_lowMemory: false }) as GuardedChatResult<T>;
  };
}
