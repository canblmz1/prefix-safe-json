import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { GuardCapture } from "./recording-types.js";
import { GuardRefusal, inspectWire, type ResponseObservation } from "./wire.js";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

interface Manifest {
  formatVersion: 1;
  protocol: "openai-chat-completions-sse";
  bodyFile: "response.sse";
  bodySha256: string;
  bodyBytes: number;
  bodyComplete: boolean;
  toolSchemas: Record<string, object>;
  decision: ResponseObservation;
}

/**
 * Node-only, opt-in local recorder. Default: refused responses only. A manifest
 * is published last, so an interrupted write cannot look like a valid capture.
 * Raw response text/arguments/schema descriptions may contain secrets.
 */
export function createFileRecorder(options: { directory: string; mode?: "refused" | "all"; onSaved?: (manifestPath: string) => void | Promise<void> }) {
  if (!options.directory || (options.mode !== undefined && !["refused", "all"].includes(options.mode))) throw new Error("Supply a recording directory and mode refused or all.");
  const directory = resolve(options.directory);
  return async (capture: GuardCapture): Promise<void> => {
    if (options.mode !== "all" && capture.decision.status !== "refused") return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const entry = await mkdtemp(join(directory, "response-"));
    const manifest: Manifest = { formatVersion: 1, protocol: capture.protocol, bodyFile: "response.sse", bodySha256: hash(capture.body),
      bodyBytes: capture.body.byteLength, bodyComplete: capture.bodyComplete, toolSchemas: capture.toolSchemas, decision: capture.decision };
    await writeFile(join(entry, "response.sse"), capture.body, { flag: "wx", mode: 0o600 });
    const target = join(entry, "recording.json");
    await writeFile(target, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    await options.onSaved?.(target);
  };
}

async function readFileBounded(path: string, max: number): Promise<Uint8Array> {
  // Refuse symlinks and read from one open handle with a hard allocation limit.
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > max) throw new Error("Recording must be a regular file within its size limit.");
  const file = await open(path, "r");
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > max) throw new Error("Recording exceeds its size limit.");
    const bytes = new Uint8Array(stat.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const read = await file.read(bytes, size, bytes.length - size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size !== stat.size) throw new Error("Recording changed while reading.");
    return bytes.slice(0, size);
  } finally { await file.close(); }
}

export interface ReplayReport {
  readonly formatVersion: 1;
  readonly scope: "wire-policy-only";
  readonly bodySha256: string;
  readonly bodyBytes: number;
  readonly bodyComplete: boolean;
  readonly recorded: ResponseObservation;
  readonly replayed: ResponseObservation;
}

/** Offline wire-policy replay. Runs no SDK, application validators or tools. */
export async function replayRecording(manifestPath: string): Promise<ReplayReport> {
  const target = resolve(manifestPath);
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFileBounded(target, 1024 * 1024)));
  if (!object(value) || value.formatVersion !== 1 || value.protocol !== "openai-chat-completions-sse" || value.bodyFile !== "response.sse" ||
      typeof value.bodyComplete !== "boolean" || !Number.isSafeInteger(value.bodyBytes) || Number(value.bodyBytes) < 0 ||
      typeof value.bodySha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.bodySha256) || !object(value.toolSchemas) ||
      Object.values(value.toolSchemas).some(schema => !object(schema)) || !object(value.decision) ||
      !["allowed", "refused"].includes(String(value.decision.status)) || !Number.isSafeInteger(value.decision.toolCalls) || Number(value.decision.toolCalls) < 0 ||
      (value.decision.reason !== undefined && (typeof value.decision.reason !== "string" || !/^[a-z][a-z0-9_]{0,100}$/u.test(value.decision.reason)))) throw new Error("Unsupported or invalid recording manifest.");
  const body = await readFileBounded(join(dirname(target), "response.sse"), 64 * 1024 * 1024);
  if (body.byteLength !== value.bodyBytes || hash(body) !== value.bodySha256) throw new Error("Recording body hash or length mismatch.");
  let replayed: ResponseObservation;
  if (!value.bodyComplete) replayed = { status: "refused", toolCalls: 0, reason: "incomplete_recording" };
  else {
    try {
      const result = inspectWire(body, value.toolSchemas as Record<string, object>);
      replayed = { status: "allowed", toolCalls: result.decisions.length };
    } catch (error) {
      if (!(error instanceof GuardRefusal)) throw new Error("Wire policy could not inspect this recording.");
      replayed = { status: "refused", toolCalls: 0, reason: error.reason };
    }
  }
  // Project only fixed fields; neither original bodies nor manifest extras leak.
  const recorded: ResponseObservation = { status: value.decision.status as "allowed" | "refused", toolCalls: Number(value.decision.toolCalls),
    ...(typeof value.decision.reason === "string" ? { reason: value.decision.reason } : {}) };
  return { formatVersion: 1, scope: "wire-policy-only", bodySha256: hash(body), bodyBytes: body.byteLength,
    bodyComplete: value.bodyComplete, recorded, replayed };
}
