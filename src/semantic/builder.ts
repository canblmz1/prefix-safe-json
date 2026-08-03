// ---------------------------------------------------------------------------
// Semantic Event Builder
// ---------------------------------------------------------------------------
//
// Accumulates parser events and manages the event queue.
// Events are emitted monotonically with increasing sequence numbers.
// drainEvents() returns pending events and clears the queue.
// ---------------------------------------------------------------------------

import type {
  ParserEvent,
  JsonValue,
  Diagnostic,
  RepairAction,
} from "../types.js";

/**
 * Manages the monotonic event queue.
 * Events are never retracted once emitted.
 */
export class EventBuilder {
  private queue: ParserEvent[] = [];
  private sequence = 0;
  private maxQueued: number;
  private terminal = false;

  constructor(maxQueuedEvents: number) {
    this.maxQueued = maxQueuedEvents;
  }

  /** Current sequence number. */
  get currentSequence(): number {
    return this.sequence;
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  /** Number of events in the queue. */
  get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Emit a value_committed event.
   */
  emitValueCommitted(
    path: string,
    value: JsonValue,
    byteRange: readonly [number, number],
  ): void {
    this.enqueue({
      type: "value_committed",
      sequence: this.sequence++,
      path,
      operation: "add",
      value,
      byteRange,
    });
  }

  /**
   * Emit a container_closed event.
   */
  emitContainerClosed(
    path: string,
    container: "object" | "array",
  ): void {
    this.enqueue({
      type: "container_closed",
      sequence: this.sequence++,
      path,
      container,
    });
  }

  /**
   * Emit a repair_applied event.
   */
  emitRepairApplied(repair: RepairAction): void {
    this.enqueue({
      type: "repair_applied",
      sequence: this.sequence++,
      repair,
    });
  }

  /**
   * Emit a diagnostic event.
   */
  emitDiagnostic(diagnostic: Diagnostic): void {
    this.enqueue({
      type: "diagnostic",
      sequence: this.sequence++,
      diagnostic,
    });
  }

  /**
   * Emit a document_complete event.
   */
  emitDocumentComplete(executable: boolean): void {
    this.enqueue({
      type: "document_complete",
      sequence: this.sequence++,
      executable,
    });
  }

  /**
   * Emit a stream_finished event.
   */
  emitStreamFinished(
    outcome: "valid" | "truncated" | "salvaged" | "invalid",
  ): void {
    this.enqueue({
      type: "stream_finished",
      sequence: this.sequence++,
      outcome,
    });
  }

  /**
   * Drain all pending events and clear the queue.
   * Returns a frozen array.
   */
  drain(): readonly ParserEvent[] {
    const events = this.queue;
    this.queue = [];
    return Object.freeze(events);
  }

  /**
   * Get the number of events emitted during the current push cycle.
   * Call resetPushCount() before push processing.
   */
  private pushEmitCount = 0;

  resetPushCount(): void {
    this.pushEmitCount = 0;
  }

  get emittedDuringPush(): number {
    return this.pushEmitCount;
  }

  private enqueue(event: ParserEvent): void {
    if (this.terminal) return; // Stop accepting semantic progress, don't report as emitted
    
    if (this.queue.length >= this.maxQueued) {
      this.terminal = true;
      // Emit terminal diagnostic if capacity theoretically permitted (i.e. we just push one more)
      this.queue.push({
        type: "diagnostic",
        sequence: this.sequence++,
        diagnostic: {
          code: "E_LIMIT_EVENT_QUEUE",
          severity: "fatal",
          byteOffset: 0, // Event builder doesn't track exact byte offset
          recoverable: false,
          message: "Event queue capacity exceeded",
        }
      });
      this.pushEmitCount++;
      return;
    }

    this.queue.push(event);
    this.pushEmitCount++;
  }
}
