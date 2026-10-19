import type { ResponseObservation } from "./wire.js";

/** Sensitive, explicitly opted-in local evidence; never contains request headers. */
export interface GuardCapture {
  readonly formatVersion: 1;
  readonly protocol: "openai-chat-completions-sse";
  readonly body: Uint8Array;
  /** False on interruption, cancellation or a bounded/truncated capture. */
  readonly bodyComplete: boolean;
  readonly toolSchemas: Record<string, object>;
  /** Batch validation outcome, not confirmation of execution or side effects. */
  readonly decision: ResponseObservation;
}
