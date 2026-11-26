import { createToolCallExecutionGate } from "../gate/gate.js";
import type { ExecutionDecision, ToolCallExecutionGate } from "../gate/types.js";
import type { CoordinatorDiagnostic, CoordinatorLimits } from "../coordinator/types.js";
import { OpenAIStreamAdapter } from "../providers/openai.js";
import type { ParserOptions } from "../types.js";
import { createAjvValidator } from "../validation/ajv-validator.js";
import {
  fromStandardSchema,
  sameJsonValue,
  type StandardSchemaV1Like,
} from "../validation/standard-schema-validator.js";
import { buildValidatorMap, type ToolInputValidator, type ToolValidationResult } from "../validation/types.js";

const DEFAULT_MAX_EVENT_BYTES = 8 * 1024 * 1024;
const MAX_ALLOWED_EVENT_BYTES = 64 * 1024 * 1024;
const AI_SDK_SCHEMA_MARKER = Symbol.for("vercel.ai.schema");

/**
 * Shape of a LangChain `ToolCall` object passed to `tool.invoke(toolCall, config)`
 * by LangGraph's `ToolNode` or manual tool execution loops.
 */
export interface LangChainToolCallLike {
  /** Marker identifying a LangChain `ToolCall` payload (typically `"tool_call"`). */
  readonly type?: string;
  /** Provider-assigned tool call ID. */
  readonly id?: string;
  /** Tool name requested by the model. */
  readonly name?: string;
  /** Parsed/repaired argument projection produced by the SDK. */
  readonly args?: unknown;
}

/**
 * Shape of the second `config` / `ToolRuntime` argument forwarded to a LangChain
 * tool's `invoke()` or `call()` method.
 */
export interface LangChainToolConfigLike {
  /** LangChain `ToolCall` metadata attached by `ToolNode` or `StructuredTool.invoke`. */
  readonly toolCall?: LangChainToolCallLike;
  /** Direct tool call ID attached by LangGraph `ToolRuntime`. */
  readonly toolCallId?: string;
  readonly [key: string]: unknown;
}

/**
 * Structural subset of a LangChain / LangGraph tool (`tool(...)`, `DynamicStructuredTool`,
 * `DynamicTool`, `StructuredTool`) required by `guardTool()`.
 */
export interface LangChainToolLike {
  /** Registered tool name matching the model's tool call name. */
  readonly name: string;
  /** Optional tool description. */
  readonly description?: string;
  /** Optional Zod, Standard Schema, or JSON Schema definition for automatic input validation. */
  readonly schema?: unknown;
  /** Standard LangChain runnable invocation entrypoint. */
  invoke(input: unknown, config?: LangChainToolConfigLike): unknown;
  /** Optional legacy LangChain invocation entrypoint. */
  call?(arg: unknown, configArg?: unknown, tags?: unknown): unknown;
}

/**
 * Subset of `ChatOpenAI`'s `configuration` field used by `guardChatOpenAI()`.
 */
export interface LangChainChatOpenAIConfiguration {
  /** Optional base URL for OpenAI or an OpenAI-compatible endpoint. */
  readonly baseURL?: string;
  /** Optional custom `fetch` implementation to wrap instead of `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  readonly [key: string]: unknown;
}

/**
 * Subset of `ChatOpenAI` constructor options accepted by `guard.chatOptions()`.
 */
export interface LangChainChatOpenAIOptions {
  /** OpenAI client configuration passed through to `ChatOpenAI`. */
  readonly configuration?: LangChainChatOpenAIConfiguration;
  readonly [key: string]: unknown;
}

/**
 * Gate outcome recorded when a guarded HTTP turn finishes.
 */
export interface LangChainTurnResult {
  /** Transport wire protocol observed for the response body. */
  readonly protocol: "sse" | "json";
  /** Final execution decisions produced by `ToolCallExecutionGate`. */
  readonly decisions: readonly ExecutionDecision[];
  /** Stream- and call-level diagnostics produced by the coordinator/gate. */
  readonly diagnostics: readonly CoordinatorDiagnostic[];
  /** Framing or decoding error observed on the raw HTTP/SSE wire, if any. */
  readonly framingError?: string;
}

/**
 * Options for `guardChatOpenAI()`.
 */
export interface LangChainGuardOptions {
  /** Default OpenAI client configuration (such as `baseURL`) forwarded via `guard.configuration`. */
  readonly configuration?: LangChainChatOpenAIConfiguration;
  /** Custom `fetch` implementation to wrap (falls back to `configuration.fetch` or `globalThis.fetch`). */
  readonly fetch?: typeof fetch;
  /** Explicit JSON Schema (draft-07) documents keyed by tool name. */
  readonly schemas?: Record<string, object>;
  /** Explicit custom `ToolInputValidator` instances keyed by tool name. */
  readonly validators?: Record<string, ToolInputValidator>;
  /** Coordinator resource limits passed to `createToolCallExecutionGate()`. */
  readonly limits?: Partial<CoordinatorLimits>;
  /** Parser options passed to `createToolCallExecutionGate()`. */
  readonly parserOptions?: ParserOptions;
  /** Maximum bytes permitted for a single SSE frame or non-streaming JSON response (default 8 MiB). */
  readonly maxEventBytes?: number;
  /** Optional observer called once per completed or failed guarded HTTP response. */
  readonly onTurnResult?: (result: LangChainTurnResult) => void;
}

/**
 * Guard controller returned by `guardChatOpenAI()`.
 */
export interface LangChainGuard {
  /** Drop-in `fetch` replacement to pass to `new ChatOpenAI({ configuration: { fetch: guard.fetch } })`. */
  readonly fetch: typeof fetch;
  /** Ready-to-pass `configuration` object containing `{ ...options.configuration, fetch: guard.fetch }`. */
  readonly configuration: LangChainChatOpenAIConfiguration & { readonly fetch: typeof fetch };
  /** Merges `guard.configuration` into a `ChatOpenAI` options object, preserving and wrapping any custom `fetch`. */
  chatOptions<TOptions extends LangChainChatOpenAIOptions>(
    options: TOptions,
  ): TOptions & {
    readonly configuration: NonNullable<TOptions["configuration"]> & { readonly fetch: typeof fetch };
  };
  /** Returns a proxy around a LangChain tool that refuses execution unless the latest raw response confirmed its arguments. */
  guardTool<TTool extends LangChainToolLike>(tool: TTool): TTool;
  /** Convenience wrapper that applies `guardTool()` to an array or tuple of LangChain tools. */
  guardTools<TTools extends readonly LangChainToolLike[]>(
    tools: TTools,
  ): { [K in keyof TTools]: TTools[K] };
  /** Low-level one-shot admission check usable directly inside a custom tool function `(input, config) => ...`. */
  take<T = unknown>(input: T, config?: LangChainToolConfigLike): T;
  /** Returns the most recent completed turn's gate decisions and diagnostics, if any. */
  lastTurnResult(): LangChainTurnResult | undefined;
  /** Immediately revokes any unconsumed execution authority from the current turn. */
  revoke(): void;
}

/**
 * Error thrown when a guarded LangChain tool call lacks confirmed raw-stream execution authority.
 */
export class LangChainGuardRefusal extends Error {
  /** Stable machine-readable error code for `prefix-safe-json` refusals. */
  readonly code = "PSJ_EXECUTION_REFUSED";
  /** Specific refusal reason (gate `ExecutionReason`, framing error, or admission error). */
  readonly reason: string;
  /** Tool call ID associated with the refused invocation, when available. */
  readonly toolCallId?: string;
  /** Tool name associated with the refused invocation, when available. */
  readonly toolName?: string;
  /** Underlying gate decision for the call, when one exists. */
  readonly decision?: ExecutionDecision;

  constructor(
    reason: string,
    details?: {
      readonly toolCallId?: string;
      readonly toolName?: string;
      readonly decision?: ExecutionDecision;
    },
  ) {
    const toolLabel = details?.toolName ? JSON.stringify(details.toolName) : "<unknown>";
    const idSuffix = details?.toolCallId ? ` (id: ${details.toolCallId})` : "";
    super(`prefix-safe-json refused tool call ${toolLabel}${idSuffix}: ${reason}`);
    this.name = "LangChainGuardRefusal";
    this.reason = reason;
    this.toolCallId = details?.toolCallId;
    this.toolName = details?.toolName;
    this.decision = details?.decision;
  }
}

interface ActiveTurn {
  readonly gate: ToolCallExecutionGate;
  readonly decisions: readonly ExecutionDecision[];
  readonly framingError?: string;
  readonly consumedIds: Set<string>;
}

interface ZodV3SafeParseError {
  readonly success: false;
  readonly error?: {
    readonly message?: string;
    readonly issues?: ReadonlyArray<{ readonly message?: string; readonly path?: ReadonlyArray<PropertyKey> }>;
  };
}

interface ZodV3LikeSchema {
  safeParse(value: unknown): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

function isThenable(value: unknown): value is Promise<unknown> {
  return isRecord(value) && typeof value.then === "function";
}

function isStandardSchemaV1Like(value: unknown): value is StandardSchemaV1Like {
  if ((!isRecord(value) && typeof value !== "function") || !("~standard" in value)) return false;
  const standard = (value as { "~standard": unknown })["~standard"];
  return (
    isRecord(standard) &&
    standard.version === 1 &&
    typeof standard.vendor === "string" &&
    typeof standard.validate === "function"
  );
}

function isZodV3Like(value: unknown): value is ZodV3LikeSchema {
  return isRecord(value) && typeof (value as { safeParse?: unknown }).safeParse === "function";
}

function createZodV3Validator(schema: ZodV3LikeSchema): ToolInputValidator {
  return {
    validate(value: unknown): ToolValidationResult {
      const result: unknown = schema.safeParse(value);
      if (isThenable(result)) {
        void Promise.resolve(result).catch(() => undefined);
        throw new Error(
          "prefix-safe-json: guardChatOpenAI() only supports synchronous Zod validators.",
        );
      }
      if (!isRecord(result) || typeof result.success !== "boolean") {
        throw new Error(
          "prefix-safe-json: tool schema safeParse() did not return a { success: boolean } result.",
        );
      }
      if (result.success) {
        return { valid: true };
      }
      const errObj = (result as unknown as ZodV3SafeParseError).error;
      const issues = Array.isArray(errObj?.issues)
        ? errObj.issues.map((issue) => {
            const path =
              Array.isArray(issue.path) && issue.path.length > 0
                ? issue.path.map(String).join(".")
                : "<root>";
            return `${path} ${issue.message ?? "invalid"}`.trim();
          })
        : errObj?.message
          ? [errObj.message]
          : ["Schema validation failed"];
      return { valid: false, errors: issues };
    },
  };
}

function deriveToolValidator(toolName: string, schema: unknown): ToolInputValidator | undefined {
  if (schema === undefined || schema === null) return undefined;
  if (isStandardSchemaV1Like(schema)) {
    return fromStandardSchema(schema);
  }
  if (isZodV3Like(schema)) {
    return createZodV3Validator(schema);
  }
  if (isPlainObject(schema) && !(AI_SDK_SCHEMA_MARKER in schema)) {
    // Plain JSON Schema object (e.g. LangChain DynamicStructuredTool with JSON Schema)
    return createAjvValidator(schema);
  }
  throw new Error(
    `prefix-safe-json: tool ${JSON.stringify(toolName)} has an unsupported schema shape; ` +
      `register an explicit validator via options.validators[${JSON.stringify(toolName)}] or options.schemas.`,
  );
}

function isToolCallPayload(value: unknown): value is LangChainToolCallLike {
  return isRecord(value) && value.type === "tool_call";
}

function stripBodyFramingHeaders(headers: Headers): Headers {
  const next = new Headers(headers);
  for (const key of ["content-encoding", "content-length", "transfer-encoding"]) {
    next.delete(key);
  }
  return next;
}

function createIncrementalSseProcessor(
  adapter: OpenAIStreamAdapter,
  gate: ToolCallExecutionGate,
  maxEventBytes: number,
) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let lineBuffer = "";
  let dataLines: string[] = [];
  let pendingCR = false;
  let bufferedEventBytes = 0;
  let sawDone = false;
  let framingError: string | undefined;

  const dispatchFrame = (): void => {
    if (dataLines.length === 0) return;
    const payload = dataLines.join("\n");
    dataLines = [];
    bufferedEventBytes = 0;
    if (framingError) return;
    if (sawDone) {
      framingError = "evidence_after_done";
      return;
    }
    if (payload === "[DONE]") {
      sawDone = true;
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      framingError = "invalid_sse_json";
      return;
    }
    if (!isPlainObject(parsed)) {
      framingError = "invalid_sse_event";
      return;
    }
    for (const event of adapter.push(parsed)) {
      gate.push(event);
    }
  };

  const processLine = (line: string): void => {
    if (line === "") {
      dispatchFrame();
      return;
    }
    if (framingError) return;
    if (line === "data") {
      dataLines.push("");
    } else if (line.startsWith("data:")) {
      const value = line.slice(5);
      dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    }
    // Comments (`:...`) and `event:` / `id:` / `retry:` lines are valid SSE metadata
    // and intentionally ignored once accounted for in the byte budget.
  };

  const processText = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (pendingCR) {
        pendingCR = false;
        if (ch === "\n") {
          continue;
        }
      }
      if (ch === "\r") {
        pendingCR = true;
        processLine(lineBuffer);
        lineBuffer = "";
      } else if (ch === "\n") {
        processLine(lineBuffer);
        lineBuffer = "";
      } else if (!framingError) {
        lineBuffer += ch;
      }
    }
  };

  return {
    /** Whether the Chat Completions `[DONE]` terminator has been dispatched. */
    sawDone(): boolean {
      return sawDone;
    },
    push(chunk: Uint8Array): void {
      if (framingError) return;
      bufferedEventBytes += chunk.byteLength;
      if (bufferedEventBytes > maxEventBytes) {
        framingError = "resource_limit";
        lineBuffer = "";
        dataLines = [];
        return;
      }
      let decoded: string;
      try {
        decoded = decoder.decode(chunk, { stream: true });
      } catch {
        framingError = "invalid_utf8";
        return;
      }
      processText(decoded);
    },
    finish(): string | undefined {
      if (!framingError) {
        try {
          const tail = decoder.decode();
          if (tail.length > 0) {
            processText(tail);
          }
        } catch {
          framingError = "invalid_utf8";
        }
      }
      if (!framingError && (lineBuffer.trim().length > 0 || dataLines.length > 0)) {
        framingError = "unfinished_sse_event";
      }
      return framingError;
    },
  };
}

function feedNonStreamingJson(
  parsed: unknown,
  adapter: OpenAIStreamAdapter,
  gate: ToolCallExecutionGate,
): string | undefined {
  if (!isPlainObject(parsed)) {
    return "invalid_json_response";
  }

  // Responses API non-streaming response shape (check before generic `error` so `status: "failed"` keeps `error.code`)
  if (parsed.object === "response" && Array.isArray(parsed.output)) {
    for (const item of parsed.output) {
      if (!isRecord(item) || item.type !== "function_call") continue;
      if (typeof item.id !== "string" || item.id.length === 0) {
        return "invalid_json_response";
      }
      for (const ev of adapter.push({
        type: "response.output_item.added",
        item: {
          type: "function_call",
          id: item.id,
          call_id: typeof item.call_id === "string" ? item.call_id : undefined,
          name: typeof item.name === "string" ? item.name : undefined,
        },
      })) {
        gate.push(ev);
      }
      if (typeof item.arguments === "string" && item.arguments.length > 0) {
        for (const ev of adapter.push({
          type: "response.function_call_arguments.delta",
          item_id: item.id,
          delta: item.arguments,
        })) {
          gate.push(ev);
        }
      }
      if (item.status === "completed") {
        for (const ev of adapter.push({
          type: "response.output_item.done",
          item: { id: item.id },
        })) {
          gate.push(ev);
        }
      }
    }

    if (parsed.status === "completed" && (parsed.error === undefined || parsed.error === null)) {
      for (const ev of adapter.push({
        type: "response.completed",
        response: { status: "completed" },
      })) {
        gate.push(ev);
      }
    } else if (parsed.status === "incomplete") {
      const details = isRecord(parsed.incomplete_details)
        ? { reason: typeof parsed.incomplete_details.reason === "string" ? parsed.incomplete_details.reason : undefined }
        : undefined;
      for (const ev of adapter.push({
        type: "response.incomplete",
        response: { status: "incomplete", incomplete_details: details },
      })) {
        gate.push(ev);
      }
    } else if (parsed.status === "failed" || (parsed.error !== undefined && parsed.error !== null)) {
      const errObj = isRecord(parsed.error)
        ? {
            code: typeof parsed.error.code === "string" ? parsed.error.code : undefined,
            message: typeof parsed.error.message === "string" ? parsed.error.message : undefined,
          }
        : null;
      for (const ev of adapter.push({
        type: "response.failed",
        response: { status: "failed", error: errObj },
      })) {
        gate.push(ev);
      }
    }
    return undefined;
  }

  if (parsed.error !== undefined && parsed.error !== null) {
    for (const event of adapter.push({ error: parsed.error })) {
      gate.push(event);
    }
    return undefined;
  }

  // Chat Completions non-streaming response shape
  if (Array.isArray(parsed.choices)) {
    for (const rawChoice of parsed.choices) {
      if (!isRecord(rawChoice)) {
        return "invalid_json_response";
      }
      const message = isRecord(rawChoice.message) ? rawChoice.message : undefined;
      const rawToolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : undefined;
      const legacyFunctionCall = message && isRecord(message.function_call) ? message.function_call : undefined;
      const finishReason = typeof rawChoice.finish_reason === "string" ? rawChoice.finish_reason : null;

      const deltaToolCalls = rawToolCalls?.map((tc, idx) => {
        if (!isRecord(tc)) return tc;
        const fn = isRecord(tc.function) ? tc.function : undefined;
        return {
          index: typeof tc.index === "number" ? tc.index : idx,
          ...(typeof tc.id === "string" ? { id: tc.id } : {}),
          ...(fn
            ? {
                function: {
                  ...(typeof fn.name === "string" ? { name: fn.name } : {}),
                  ...(typeof fn.arguments === "string" ? { arguments: fn.arguments } : {}),
                },
              }
            : {}),
        };
      });

      const syntheticChunk = {
        choices: [
          {
            index: rawChoice.index,
            delta: {
              ...(deltaToolCalls && deltaToolCalls.length > 0 ? { tool_calls: deltaToolCalls } : {}),
              ...(legacyFunctionCall
                ? {
                    function_call: {
                      ...(typeof legacyFunctionCall.name === "string" ? { name: legacyFunctionCall.name } : {}),
                      ...(typeof legacyFunctionCall.arguments === "string"
                        ? { arguments: legacyFunctionCall.arguments }
                        : {}),
                    },
                  }
                : {}),
            },
            finish_reason: finishReason,
          },
        ],
      };

      for (const ev of adapter.push(syntheticChunk)) {
        gate.push(ev);
      }
    }
    return undefined;
  }

  return undefined;
}

async function readLimitedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<{ readonly bytes: Uint8Array; readonly exceeded: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return { bytes: buffer, exceeded: buffer.byteLength > maxBytes };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) {
        const remaining = maxBytes - (total - next.value.byteLength);
        if (remaining > 0) chunks.push(next.value.slice(0, remaining));
        await reader.cancel().catch(() => undefined);
        const capped = new Uint8Array(maxBytes);
        let offset = 0;
        for (const c of chunks) {
          capped.set(c, offset);
          offset += c.byteLength;
        }
        return { bytes: capped.subarray(0, offset), exceeded: true };
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { bytes: combined, exceeded: false };
}

/**
 * @public (Experimental)
 * Creates a fail-closed execution guard for LangChain / LangGraph.js (`ChatOpenAI` +
 * `createReactAgent` / `ToolNode`).
 *
 * Wraps the OpenAI HTTP transport (`fetch`) to evaluate raw SSE / JSON tool-call
 * evidence through `OpenAIStreamAdapter` and `createToolCallExecutionGate()`, and wraps
 * LangChain tools (`guardTool` / `guardTools`) so no tool executes unless the raw wire
 * response confirmed complete, schema-valid, unambiguously identified arguments.
 */
export function guardChatOpenAI(options?: LangChainGuardOptions): LangChainGuard {
  const maxEventBytes = options?.maxEventBytes ?? DEFAULT_MAX_EVENT_BYTES;
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes < 1 || maxEventBytes > MAX_ALLOWED_EVENT_BYTES) {
    throw new Error(
      `prefix-safe-json: maxEventBytes must be an integer between 1 and ${MAX_ALLOWED_EVENT_BYTES}.`,
    );
  }

  // Validate and compile explicit registrations up front (fail fast, identical to gate).
  const explicitValidators = buildValidatorMap(options?.schemas, options?.validators);
  const autoValidators = new Map<string, ToolInputValidator>();
  const registeredToolTargets = new Map<string, object>();
  const wrappedProxies = new WeakMap<object, object>();
  const proxyToTarget = new WeakMap<object, object>();

  const defaultUpstreamFetch = options?.fetch ?? options?.configuration?.fetch ?? globalThis.fetch;

  let turnSeq = 0;
  let activeTurn: ActiveTurn | undefined;
  let latestResult: LangChainTurnResult | undefined;

  const createGateForTurn = (): ToolCallExecutionGate => {
    const combined: Record<string, ToolInputValidator> = Object.create(null) as Record<string, ToolInputValidator>;
    for (const [name, validator] of autoValidators.entries()) {
      combined[name] = validator;
    }
    for (const [name, validator] of explicitValidators.entries()) {
      combined[name] = validator;
    }
    return createToolCallExecutionGate(options?.limits, options?.parserOptions, undefined, combined);
  };

  const notifyTurn = (result: LangChainTurnResult): void => {
    if (!options?.onTurnResult) return;
    try {
      options.onTurnResult(result);
    } catch {
      // Observer failures must never suppress fail-closed state updates or grant authority.
    }
  };

  const revoke = (): void => {
    turnSeq++;
    activeTurn = undefined;
  };

  const wrapFetch = (upstreamFetch: typeof fetch): typeof fetch => {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const turn = ++turnSeq;
      activeTurn = undefined;

      const response = await upstreamFetch(input, init);
      if (!response.ok) {
        return response;
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (/^text\/event-stream(?:;|$)/iu.test(contentType)) {
        const reader = response.body?.getReader();
        if (!reader) {
          const gate = createGateForTurn();
          const final = gate.finish({ reason: "network_error" });
          const turnResult: LangChainTurnResult = {
            protocol: "sse",
            decisions: final.decisions,
            diagnostics: final.diagnostics,
            framingError: "missing_body",
          };
          if (turn === turnSeq) {
            latestResult = turnResult;
            activeTurn = { gate, decisions: final.decisions, framingError: "missing_body", consumedIds: new Set() };
          }
          notifyTurn(turnResult);
          return response;
        }

        const adapter = new OpenAIStreamAdapter();
        const gate = createGateForTurn();
        const sse = createIncrementalSseProcessor(adapter, gate, maxEventBytes);
        let settled = false;

        const finalizeSseTurn = (
          overrideReason?: "network_error" | "cancelled",
          overrideFramingError?: string,
        ): void => {
          if (settled) return;
          settled = true;
          const framingError = overrideFramingError ?? sse.finish();
          for (const event of adapter.finish(overrideReason ? { reason: overrideReason } : undefined)) {
            gate.push(event);
          }
          const final = gate.finish(overrideReason ? { reason: overrideReason } : undefined);
          const turnResult: LangChainTurnResult = {
            protocol: "sse",
            decisions: final.decisions,
            diagnostics: final.diagnostics,
            ...(framingError ? { framingError } : {}),
          };
          if (turn === turnSeq) {
            latestResult = turnResult;
            activeTurn = overrideReason
              ? undefined
              : { gate, decisions: final.decisions, framingError, consumedIds: new Set() };
          }
          notifyTurn(turnResult);
        };

        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (next.done) {
                finalizeSseTurn();
                reader.releaseLock();
                controller.close();
                return;
              }
              sse.push(next.value);
              controller.enqueue(next.value);
            } catch (error) {
              finalizeSseTurn("network_error", "transport_error");
              reader.releaseLock();
              controller.error(error);
            }
          },
          async cancel(reason) {
            // The OpenAI SDK stops reading at the Chat Completions `[DONE]`
            // terminator and cancels the body instead of draining it to EOF.
            // `[DONE]` is the protocol's own end marker, so a cancel after it
            // is a normal end; a cancel before it stays fail-closed.
            if (sse.sawDone()) {
              finalizeSseTurn();
            } else {
              finalizeSseTurn("cancelled", "cancelled");
            }
            try {
              await reader.cancel(reason);
            } finally {
              reader.releaseLock();
            }
          },
        });

        return new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: stripBodyFramingHeaders(response.headers),
        });
      }

      if (/^application\/json(?:;|$)/iu.test(contentType)) {
        const adapter = new OpenAIStreamAdapter();
        const gate = createGateForTurn();
        let bytes: Uint8Array;
        let exceeded = false;
        try {
          const limited = await readLimitedResponseBytes(response, maxEventBytes);
          bytes = limited.bytes;
          exceeded = limited.exceeded;
        } catch (error) {
          for (const event of adapter.finish({ reason: "network_error" })) {
            gate.push(event);
          }
          const final = gate.finish({ reason: "network_error" });
          const turnResult: LangChainTurnResult = {
            protocol: "json",
            decisions: final.decisions,
            diagnostics: final.diagnostics,
            framingError: "transport_error",
          };
          if (turn === turnSeq) {
            latestResult = turnResult;
            activeTurn = undefined;
          }
          notifyTurn(turnResult);
          throw error;
        }

        let framingError: string | undefined = exceeded ? "resource_limit" : undefined;
        if (!framingError) {
          let text: string;
          try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          } catch {
            framingError = "invalid_utf8";
            text = "";
          }
          if (!framingError) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(text);
            } catch {
              framingError = "invalid_json_response";
            }
            if (!framingError) {
              framingError = feedNonStreamingJson(parsed, adapter, gate);
            }
          }
        }

        for (const event of adapter.finish()) {
          gate.push(event);
        }
        const final = gate.finish();
        const turnResult: LangChainTurnResult = {
          protocol: "json",
          decisions: final.decisions,
          diagnostics: final.diagnostics,
          ...(framingError ? { framingError } : {}),
        };
        if (turn === turnSeq) {
          latestResult = turnResult;
          activeTurn = { gate, decisions: final.decisions, framingError, consumedIds: new Set() };
        }
        notifyTurn(turnResult);

        return new Response(new Uint8Array(bytes), {
          status: response.status,
          statusText: response.statusText,
          headers: stripBodyFramingHeaders(response.headers),
        });
      }

      return response;
    };
  };

  const guardedFetch = wrapFetch(defaultUpstreamFetch);

  const consumeAuthority = (
    toolCallId: string | undefined,
    toolName: string | undefined,
    projectedInput: unknown,
  ): unknown => {
    if (!activeTurn) {
      throw new LangChainGuardRefusal("no_authority", { toolCallId, toolName });
    }
    if (activeTurn.framingError) {
      throw new LangChainGuardRefusal(activeTurn.framingError, { toolCallId, toolName });
    }
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new LangChainGuardRefusal("no_authority", { toolCallId, toolName });
    }
    if (typeof toolName !== "string" || toolName.length === 0) {
      throw new LangChainGuardRefusal("no_authority", { toolCallId, toolName });
    }

    const matches = activeTurn.decisions.filter(
      (decision) => decision.toolCallId === toolCallId && decision.name === toolName,
    );
    if (matches.length === 0) {
      throw new LangChainGuardRefusal("no_authority", { toolCallId, toolName });
    }
    if (matches.length > 1) {
      throw new LangChainGuardRefusal("protocol_violation", { toolCallId, toolName });
    }

    const decision = matches[0];
    if (!decision) {
      throw new LangChainGuardRefusal("no_authority", { toolCallId, toolName });
    }
    if (activeTurn.consumedIds.has(decision.internalId)) {
      throw new LangChainGuardRefusal("authority_reused", { toolCallId, toolName, decision });
    }
    if (decision.action !== "execute") {
      throw new LangChainGuardRefusal(decision.reason, { toolCallId, toolName, decision });
    }
    if (!sameJsonValue(decision.value, projectedInput)) {
      throw new LangChainGuardRefusal("projection_mismatch", { toolCallId, toolName, decision });
    }

    const grant = activeTurn.gate.takeDecision(decision.internalId);
    if (!grant) {
      throw new LangChainGuardRefusal(decision.reason, { toolCallId, toolName, decision });
    }

    activeTurn.consumedIds.add(decision.internalId);
    return structuredClone(grant.value);
  };

  const extractCallIdentity = (
    input: unknown,
    config: LangChainToolConfigLike | undefined,
    expectedToolName: string,
  ): {
    readonly isToolCall: boolean;
    readonly projectedInput: unknown;
    readonly toolCallId: string | undefined;
    readonly requestedToolName: string | undefined;
  } => {
    if (isToolCallPayload(input)) {
      return {
        isToolCall: true,
        projectedInput: input.args,
        toolCallId:
          typeof input.id === "string"
            ? input.id
            : typeof config?.toolCall?.id === "string"
              ? config.toolCall.id
              : typeof config?.toolCallId === "string"
                ? config.toolCallId
                : undefined,
        requestedToolName:
          typeof input.name === "string"
            ? input.name
            : typeof config?.toolCall?.name === "string"
              ? config.toolCall.name
              : expectedToolName,
      };
    }

    return {
      isToolCall: false,
      projectedInput: input,
      toolCallId:
        typeof config?.toolCall?.id === "string"
          ? config.toolCall.id
          : typeof config?.toolCallId === "string"
            ? config.toolCallId
            : undefined,
      requestedToolName:
        typeof config?.toolCall?.name === "string" ? config.toolCall.name : expectedToolName,
    };
  };

  const guardTool = <TTool extends LangChainToolLike>(tool: TTool): TTool => {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0 || typeof tool.invoke !== "function") {
      throw new Error(
        "prefix-safe-json: guardTool() requires a LangChain tool object with a non-empty `name` and `invoke()` method.",
      );
    }

    if (proxyToTarget.has(tool)) {
      return tool;
    }
    const existingProxy = wrappedProxies.get(tool);
    if (existingProxy) {
      return existingProxy as TTool;
    }

    const previousTarget = registeredToolTargets.get(tool.name);
    if (previousTarget !== undefined && previousTarget !== tool) {
      throw new Error(
        `prefix-safe-json: duplicate tool name ${JSON.stringify(tool.name)} passed to guardTool().`,
      );
    }
    registeredToolTargets.set(tool.name, tool);

    if (!explicitValidators.has(tool.name) && !autoValidators.has(tool.name)) {
      const derived = deriveToolValidator(tool.name, tool.schema);
      if (derived) {
        autoValidators.set(tool.name, derived);
      }
    }

    const proxy = new Proxy(tool, {
      get(target, prop) {
        if (prop === "invoke") {
          return (input: unknown, config?: LangChainToolConfigLike) => {
            const id = extractCallIdentity(input, config, target.name);
            if (id.requestedToolName !== target.name) {
              throw new LangChainGuardRefusal("tool_name_mismatch", {
                toolCallId: id.toolCallId,
                toolName: id.requestedToolName ?? target.name,
              });
            }
            const authorizedValue = consumeAuthority(id.toolCallId, target.name, id.projectedInput);
            const nextInput = id.isToolCall
              ? { ...(input as Record<string, unknown>), args: authorizedValue }
              : authorizedValue;
            return target.invoke.call(target, nextInput, config);
          };
        }

        if (prop === "call" && typeof target.call === "function") {
          const originalCall = target.call;
          return (arg: unknown, configArg?: unknown, tags?: unknown) => {
            const config = isRecord(configArg) ? (configArg as LangChainToolConfigLike) : undefined;
            const id = extractCallIdentity(arg, config, target.name);
            if (id.requestedToolName !== target.name) {
              throw new LangChainGuardRefusal("tool_name_mismatch", {
                toolCallId: id.toolCallId,
                toolName: id.requestedToolName ?? target.name,
              });
            }
            const authorizedValue = consumeAuthority(id.toolCallId, target.name, id.projectedInput);
            const nextArg = id.isToolCall
              ? { ...(arg as Record<string, unknown>), args: authorizedValue }
              : authorizedValue;
            return originalCall.call(target, nextArg, configArg, tags);
          };
        }

        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    wrappedProxies.set(tool, proxy);
    proxyToTarget.set(proxy, tool);
    return proxy;
  };

  const guardTools = <TTools extends readonly LangChainToolLike[]>(
    tools: TTools,
  ): { [K in keyof TTools]: TTools[K] } => {
    return tools.map((tool) => guardTool(tool)) as unknown as { [K in keyof TTools]: TTools[K] };
  };

  const take = <T = unknown>(input: T, config?: LangChainToolConfigLike): T => {
    const toolCallId =
      typeof config?.toolCall?.id === "string"
        ? config.toolCall.id
        : typeof config?.toolCallId === "string"
          ? config.toolCallId
          : undefined;
    const toolName = typeof config?.toolCall?.name === "string" ? config.toolCall.name : undefined;
    return consumeAuthority(toolCallId, toolName, input) as T;
  };

  const configuration: LangChainChatOpenAIConfiguration & { readonly fetch: typeof fetch } = {
    ...options?.configuration,
    fetch: guardedFetch,
  };

  const chatOptions = <TOptions extends LangChainChatOpenAIOptions>(
    chatOpts: TOptions,
  ): TOptions & {
    readonly configuration: NonNullable<TOptions["configuration"]> & { readonly fetch: typeof fetch };
  } => {
    const customFetch = chatOpts.configuration?.fetch;
    const effectiveFetch =
      customFetch && customFetch !== guardedFetch ? wrapFetch(customFetch) : guardedFetch;
    return {
      ...chatOpts,
      configuration: {
        ...options?.configuration,
        ...chatOpts.configuration,
        fetch: effectiveFetch,
      },
    } as TOptions & {
      readonly configuration: NonNullable<TOptions["configuration"]> & { readonly fetch: typeof fetch };
    };
  };

  return {
    fetch: guardedFetch,
    configuration,
    chatOptions,
    guardTool,
    guardTools,
    take,
    lastTurnResult: () => latestResult,
    revoke,
  };
}
