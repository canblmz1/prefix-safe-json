import { OpenAICompatibleStreamAdapter, createToolCallExecutionGate } from "prefix-safe-json";

export class GuardRefusal extends Error {
  readonly code = "PSJ_REFUSED";
  constructor(readonly reason: string) {
    super(`PSJ refused the original response: ${reason}. No calls from this response were released.`);
    this.name = "GuardRefusal";
  }
}

export function canonical(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || !value || seen.has(value)) throw new GuardRefusal("non_json_input");
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, item => canonical(item, seen)).join(",")}]`;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== null && prototype !== Object.prototype) throw new GuardRefusal("non_json_input");
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], seen)}`).join(",")}}`;
  } finally { seen.delete(value); }
}

export interface ResponseObservation {
  readonly status: "allowed" | "refused";
  readonly toolCalls: number;
  readonly reason?: string;
}

/** Reads each byte at most once per cursor, including frames split across reads. */
class ByteCursor {
  private chunk = 0;
  private offset = 0;
  private position = 0;
  constructor(private readonly chunks: Uint8Array[]) {}
  read(end: number): Uint8Array {
    const result = new Uint8Array(end - this.position);
    let written = 0;
    while (this.position < end) {
      const bytes = this.chunks[this.chunk]!;
      const count = Math.min(end - this.position, bytes.length - this.offset);
      result.set(bytes.subarray(this.offset, this.offset + count), written);
      written += count;
      this.position += count;
      this.offset += count;
      if (this.offset === bytes.length) { this.chunk++; this.offset = 0; }
    }
    return result;
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Conservative display-only classification. It never grants tool authority. */
function textFrame(bytes: Uint8Array): boolean {
  let frame: string;
  try { frame = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  const lines = frame.replace(/\r\n?/gu, "\n").split("\n");
  if (lines.some(line => line && !line.startsWith(":") && line !== "data" && !line.startsWith("data:"))) return false;
  const data = lines.filter(line => line === "data" || line.startsWith("data:"))
    .map(line => line === "data" ? "" : line.slice(5).replace(/^ /u, "")).join("\n");
  if (!data) return true; // Comments/keepalives carry no executable evidence.
  let event: unknown;
  try { event = JSON.parse(data); } catch { return false; }
  if (!object(event) || event.usage != null || Object.keys(event).some(key => !["id", "object", "created", "model", "system_fingerprint", "service_tier", "usage", "choices"].includes(key)) ||
      !Array.isArray(event.choices) || event.choices.length !== 1) return false;
  const choice: unknown = event.choices[0];
  if (!object(choice) || choice.index !== 0 || choice.finish_reason != null ||
      choice.logprobs != null || Object.keys(choice).some(key => !["index", "delta", "finish_reason", "logprobs"].includes(key)) || !object(choice.delta)) return false;
  return Object.entries(choice.delta).every(([key, value]) =>
    key === "role" ? value == null || value === "assistant" || value === "" :
      ["content", "reasoning_content", "reasoning"].includes(key) && (value == null || typeof value === "string"));
}

/**
 * Stream only a display-only prefix. The first tool/control/unknown frame and
 * EVERY later byte wait for EOF and whole-batch verification. Original bytes
 * and ordering are preserved, including CR, CRLF, BOM and split UTF-8.
 */
export async function guardResponse(response: Response, options: {
  limit: number;
  signal?: AbortSignal | null;
  buffered: boolean;
  validate(bytes: Uint8Array): Promise<{ toolCalls: number; commit(): void }>;
  observe(bytes: Uint8Array, complete: boolean, event: ResponseObservation): Promise<void>;
  decide(event: ResponseObservation): void;
  revoke(): void;
}): Promise<Response> {
  const { signal } = options;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  const frames = new ByteCursor(chunks), output = new ByteCursor(chunks);
  let size = 0, released = 0;
  let lineHasBytes = false, wasCR = false, holding = options.buffered;
  let cancelled = false, settled = false, complete = false;
  let ready!: () => void;
  let failed!: (error: unknown) => void;
  const firstDisplayOrVerified = new Promise<void>((resolve, reject) => { ready = resolve; failed = reject; });
  let reporting: Promise<void> | undefined;
  const bytes = () => new ByteCursor(chunks).read(size);
  const abort = () => { void reader?.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const cleanup = () => { signal?.removeEventListener("abort", abort); reader?.releaseLock(); };
  const active = () => { signal?.throwIfAborted(); if (cancelled) throw new GuardRefusal("cancelled"); };
  const report = (body: Uint8Array, event: ResponseObservation) => {
    // A recording callback is invoked once, including on cancellation/failure.
    reporting ??= options.observe(body, complete, event);
    return reporting;
  };
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!reader) throw new GuardRefusal("missing_body");
        for (;;) {
          active();
          let next: ReadableStreamReadResult<Uint8Array>;
          try { next = await reader.read(); } catch { throw new GuardRefusal("transport_error"); }
          active();
          if (next.done) {
            complete = true;
            const body = bytes();
            const checked = await options.validate(body);
            active();
            await report(body, { status: "allowed", toolCalls: checked.toolCalls });
            active();
            checked.commit();
            options.decide({ status: "allowed", toolCalls: checked.toolCalls });
            if (released < size) controller.enqueue(body.slice(released));
            settled = true;
            controller.close();
            ready();
            cleanup();
            return;
          }
          const value = next.value;
          if (size + value.byteLength > options.limit) {
            // Retain at most the configured ceiling, even for a huge read.
            const remaining = options.limit - size;
            if (remaining) chunks.push(value.slice(0, remaining));
            size += remaining;
            throw new GuardRefusal("response_limit");
          }
          chunks.push(new Uint8Array(value));
          const start = size;
          size += value.byteLength;
          let safeEnd = released;
          if (!holding) for (const [index, byte] of value.entries()) {
            if (wasCR && byte === 10) {
              // Complete a CRLF delimiter even when LF arrives in a later read.
              if (safeEnd === start + index) safeEnd++;
              wasCR = false;
              continue;
            }
            wasCR = false;
            if (byte === 10 || byte === 13) {
              if (!lineHasBytes) {
                const end = start + index + 1;
                if (!textFrame(frames.read(end))) { holding = true; break; }
                safeEnd = end;
              }
              lineHasBytes = false;
              wasCR = byte === 13;
            } else lineHasBytes = true;
          }
          if (safeEnd > released) {
            controller.enqueue(output.read(safeEnd));
            released = safeEnd;
            ready();
            return;
          }
        }
      } catch (error) {
        if (cancelled) return; // cancel() owns revocation, observation and cleanup.
        options.revoke();
        await reader?.cancel().catch(() => {});
        const failure = signal?.aborted ? signal.reason : error instanceof GuardRefusal ? error : new GuardRefusal("validation_error");
        if (!cancelled) {
          const event = { status: "refused", toolCalls: 0, reason: signal?.aborted ? "aborted" : failure instanceof GuardRefusal ? failure.reason : "validation_error" } as const;
          try { await report(bytes(), event); }
          catch { /* A recording failure cannot release a tool. */ }
          try { options.decide(event); } catch { /* Preserve the refusal even if an observer throws. */ }
          settled = true;
          controller.error(failure);
          failed(failure);
          cleanup();
        }
      }
    },
    async cancel(reason) {
      if (settled) return;
      cancelled = true;
      options.revoke();
      await reader?.cancel(reason).catch(() => {});
      const event = { status: "refused", toolCalls: 0, reason: "cancelled" } as const;
      try { await report(bytes(), event); } catch { /* Remain cancelled. */ }
      try { options.decide(event); } catch { /* Remain cancelled. */ }
      settled = true;
      failed(new GuardRefusal("cancelled"));
      cleanup();
    },
  });
  const headers = new Headers(response.headers);
  for (const key of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(key);
  // Without a display prefix, refusals remain fetch failures as in 0.1.0.
  // After a prefix has been displayed, a later refusal is a native body error.
  await firstDisplayOrVerified;
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

export function inspectWire(bytes: Uint8Array, schemas: Record<string, object>) {
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new GuardRefusal("invalid_utf8"); }
  const frames = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n").split("\n\n");
  if (frames.pop()?.trim()) throw new GuardRefusal("unfinished_sse_event");
  const adapter = new OpenAICompatibleStreamAdapter();
  const gate = createToolCallExecutionGate(undefined, undefined, schemas);
  let ended = false;
  for (const frame of frames) {
    const data = frame.split("\n").filter(line => line === "data" || line.startsWith("data:"))
      .map(line => line === "data" ? "" : line.slice(5).replace(/^ /u, "")).join("\n");
    if (!data) continue;
    if (ended) throw new GuardRefusal("evidence_after_done");
    if (data === "[DONE]") { ended = true; continue; }
    let event: unknown;
    try { event = JSON.parse(data); } catch { throw new GuardRefusal("invalid_sse_json"); }
    if (!event || typeof event !== "object" || Array.isArray(event)) throw new GuardRefusal("invalid_sse_event");
    if ("error" in event && (event as { error: unknown }).error != null) throw new GuardRefusal("provider_error");
    for (const part of adapter.push(event)) gate.push(part);
  }
  for (const part of adapter.finish()) gate.push(part);
  const final = gate.finish();
  const refusal = final.decisions.find(decision => decision.action !== "execute");
  if (refusal) throw new GuardRefusal(refusal.reason);
  return { gate, decisions: final.decisions };
}
