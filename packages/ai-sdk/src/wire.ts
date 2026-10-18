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

export async function readBounded(response: Response, limit: number, signal?: AbortSignal | null): Promise<Uint8Array> {
  if (!response.body) throw new GuardRefusal("missing_body");
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new GuardRefusal("response_limit");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (signal?.aborted) throw signal.reason;
    if (error instanceof GuardRefusal) throw error;
    throw new GuardRefusal("transport_error");
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
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
