// @ts-nocheck
// ---------------------------------------------------------------------------
// Public Types for @internal/incremental-tool-json
// ---------------------------------------------------------------------------

// --- JSON Value ---

/** Standard JSON value type. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonObject
  | JsonArray;

export interface JsonObject {
  [key: string]: JsonValue;
}

export type JsonArray = JsonValue[];

// --- Stream End Reason ---

/** Why the LLM stream ended. */
export type StreamEndReason =
  | "complete"
  | "length"
  | "network_error"
  | "provider_error"
  | "cancelled"
  | "unknown";

// --- Push Result ---

/** Returned by `push()` after feeding a chunk. */
export interface PushResult {
  /** Number of bytes accepted from this chunk. */
  acceptedBytes: number;

  /** Number of semantic events emitted during this push. */
  emittedEvents: number;

  /** Current syntactic status of the document. */
  syntax: SyntaxStatus;

  /** If true, the parser will not accept further input. */
  terminal: boolean;
}

export type SyntaxStatus = "empty" | "incomplete" | "root_complete" | "invalid";

// --- Parser Snapshot ---

/** Immutable snapshot of parser state. */
export interface ParserSnapshot {
  /** Whether we are still collecting or the stream is finished. */
  phase: "collecting" | "finished";

  /** Current syntactic status. */
  syntax: SyntaxStatus;

  /** JSON value built from only fully-committed fields. */
  stableValue?: JsonValue;

  /** Whether the root JSON container has been closed. */
  rootComplete: boolean;

  /**
   * Whether the parsed result is safe for tool execution.
   * True only when root is complete, stream finished normally,
   * no pending tokens, no fatal diagnostics, no duplicate keys,
   * and no structural/lossy repairs.
   */
  executable: boolean;

  /** Tokens still awaiting more data. */
  pending: readonly PendingToken[];

  /** Repairs applied (populated at finish). */
  repairs: readonly RepairAction[];

  /** All diagnostics emitted so far. */
  diagnostics: readonly Diagnostic[];

  /** Total bytes received via push(). */
  receivedBytes: number;

  /** Bytes successfully consumed by the parser. */
  consumedBytes: number;
}

// --- Pending Token ---

/** A value that is in-progress and not yet committed. */
export interface PendingToken {
  type:
    | "string"
    | "number"
    | "literal"
    | "unicode_escape"
    | "surrogate"
    | "object_key";
  path: string;
  buffered: string;
  byteOffset: number;
}

// --- Repair ---

/** Describes a deterministic repair applied at stream end. */
export interface RepairAction {
  code: string;
  byteRange: readonly [number, number];
  impact:
    | "representation_preserving"
    | "root_preserving"
    | "structural"
    | "lossy";
  description: string;
}

// --- Diagnostic ---

/** Structured parse diagnostic. */
export interface Diagnostic {
  code: string;
  severity: "info" | "warning" | "error" | "fatal";
  byteOffset: number;
  path?: string;
  recoverable: boolean;
  message: string;
}

// --- Semantic Events ---

export type ParserEvent =
  | ValueCommittedEvent
  | ContainerClosedEvent
  | RepairAppliedEvent
  | DiagnosticEvent
  | DocumentCompleteEvent
  | StreamFinishedEvent;

export interface ValueCommittedEvent {
  type: "value_committed";
  sequence: number;
  path: string;
  operation: "add";
  value: JsonValue;
  byteRange: readonly [number, number];
}

export interface ContainerClosedEvent {
  type: "container_closed";
  sequence: number;
  path: string;
  container: "object" | "array";
}

export interface RepairAppliedEvent {
  type: "repair_applied";
  sequence: number;
  repair: RepairAction;
}

export interface DiagnosticEvent {
  type: "diagnostic";
  sequence: number;
  diagnostic: Diagnostic;
}

export interface DocumentCompleteEvent {
  type: "document_complete";
  sequence: number;
  executable: boolean;
}

export interface StreamFinishedEvent {
  type: "stream_finished";
  sequence: number;
  outcome: "valid" | "truncated" | "salvaged" | "invalid";
}

// --- Final Result ---

/** Returned by `finish()`. */
export interface FinalResult {
  /** Final syntactic status. */
  syntax: SyntaxStatus;

  /** Overall parse outcome. */
  outcome: "valid" | "truncated" | "salvaged" | "invalid";

  /** JSON value from committed fields only. */
  stableValue?: JsonValue;

  /** Whether the result is safe for tool execution. */
  executable: boolean;

  /** All repairs applied during finalization. */
  repairs: readonly RepairAction[];

  /** All diagnostics. */
  diagnostics: readonly Diagnostic[];

  /** Total received bytes. */
  receivedBytes: number;

  /** Consumed bytes. */
  consumedBytes: number;
}

// --- Parser Interface ---

/** The incremental parser API. */
export interface IncrementalJsonParser {
  /** Feed a chunk of data. */
  push(chunk: string | Uint8Array): PushResult;

  /** Get a snapshot of the current parser state. */
  snapshot(): ParserSnapshot;

  /** Drain and return all unconsumed events, clearing the queue. */
  drainEvents(): readonly ParserEvent[];

  /** Signal stream completion. Must be called exactly once. */
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): FinalResult;
}

// --- Parser Options ---

export interface RepairOptions {
  readonly rawControlCharacters: "reject" | "escape";
  readonly trailingData: "reject" | "isolate";
  readonly closeContainersAtFinish: "disabled" | "safe-only";
}

export interface ParserOptions {
  limits?: Partial<ParserLimits>;
  repairs?: Partial<RepairOptions>;
}

// --- Limits ---

export interface ParserLimits {
  maxInputBytes: number;
  maxDepth: number;
  maxStringBytes: number;
  maxQueuedEvents: number;
  maxTrailingDataBytes: number;
}
