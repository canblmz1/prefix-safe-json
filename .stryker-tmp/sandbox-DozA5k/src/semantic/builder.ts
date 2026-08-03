// @ts-nocheck
// ---------------------------------------------------------------------------
// Semantic Event Builder
// ---------------------------------------------------------------------------
//
// Accumulates parser events and manages the event queue.
// Events are emitted monotonically with increasing sequence numbers.
// drainEvents() returns pending events and clears the queue.
// ---------------------------------------------------------------------------
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
import type { ParserEvent, JsonValue, Diagnostic, RepairAction } from "../types.js";

/**
 * Manages the monotonic event queue.
 * Events are never retracted once emitted.
 */
export class EventBuilder {
  private queue: ParserEvent[] = stryMutAct_9fa48("2834") ? ["Stryker was here"] : (stryCov_9fa48("2834"), []);
  private sequence = 0;
  private maxQueued: number;
  private terminal = stryMutAct_9fa48("2835") ? true : (stryCov_9fa48("2835"), false);
  constructor(maxQueuedEvents: number) {
    if (stryMutAct_9fa48("2836")) {
      {}
    } else {
      stryCov_9fa48("2836");
      this.maxQueued = maxQueuedEvents;
    }
  }

  /** Current sequence number. */
  get currentSequence(): number {
    if (stryMutAct_9fa48("2837")) {
      {}
    } else {
      stryCov_9fa48("2837");
      return this.sequence;
    }
  }
  get isTerminal(): boolean {
    if (stryMutAct_9fa48("2838")) {
      {}
    } else {
      stryCov_9fa48("2838");
      return this.terminal;
    }
  }

  /** Number of events in the queue. */
  get queueLength(): number {
    if (stryMutAct_9fa48("2839")) {
      {}
    } else {
      stryCov_9fa48("2839");
      return this.queue.length;
    }
  }

  /**
   * Emit a value_committed event.
   */
  emitValueCommitted(path: string, value: JsonValue, byteRange: readonly [number, number]): void {
    if (stryMutAct_9fa48("2840")) {
      {}
    } else {
      stryCov_9fa48("2840");
      this.enqueue(stryMutAct_9fa48("2841") ? {} : (stryCov_9fa48("2841"), {
        type: stryMutAct_9fa48("2842") ? "" : (stryCov_9fa48("2842"), "value_committed"),
        sequence: stryMutAct_9fa48("2843") ? this.sequence-- : (stryCov_9fa48("2843"), this.sequence++),
        path,
        operation: stryMutAct_9fa48("2844") ? "" : (stryCov_9fa48("2844"), "add"),
        value,
        byteRange
      }));
    }
  }

  /**
   * Emit a container_closed event.
   */
  emitContainerClosed(path: string, container: "object" | "array"): void {
    if (stryMutAct_9fa48("2845")) {
      {}
    } else {
      stryCov_9fa48("2845");
      this.enqueue(stryMutAct_9fa48("2846") ? {} : (stryCov_9fa48("2846"), {
        type: stryMutAct_9fa48("2847") ? "" : (stryCov_9fa48("2847"), "container_closed"),
        sequence: stryMutAct_9fa48("2848") ? this.sequence-- : (stryCov_9fa48("2848"), this.sequence++),
        path,
        container
      }));
    }
  }

  /**
   * Emit a repair_applied event.
   */
  emitRepairApplied(repair: RepairAction): void {
    if (stryMutAct_9fa48("2849")) {
      {}
    } else {
      stryCov_9fa48("2849");
      this.enqueue(stryMutAct_9fa48("2850") ? {} : (stryCov_9fa48("2850"), {
        type: stryMutAct_9fa48("2851") ? "" : (stryCov_9fa48("2851"), "repair_applied"),
        sequence: stryMutAct_9fa48("2852") ? this.sequence-- : (stryCov_9fa48("2852"), this.sequence++),
        repair
      }));
    }
  }

  /**
   * Emit a diagnostic event.
   */
  emitDiagnostic(diagnostic: Diagnostic): void {
    if (stryMutAct_9fa48("2853")) {
      {}
    } else {
      stryCov_9fa48("2853");
      this.enqueue(stryMutAct_9fa48("2854") ? {} : (stryCov_9fa48("2854"), {
        type: stryMutAct_9fa48("2855") ? "" : (stryCov_9fa48("2855"), "diagnostic"),
        sequence: stryMutAct_9fa48("2856") ? this.sequence-- : (stryCov_9fa48("2856"), this.sequence++),
        diagnostic
      }));
    }
  }

  /**
   * Emit a document_complete event.
   */
  emitDocumentComplete(executable: boolean): void {
    if (stryMutAct_9fa48("2857")) {
      {}
    } else {
      stryCov_9fa48("2857");
      this.enqueue(stryMutAct_9fa48("2858") ? {} : (stryCov_9fa48("2858"), {
        type: stryMutAct_9fa48("2859") ? "" : (stryCov_9fa48("2859"), "document_complete"),
        sequence: stryMutAct_9fa48("2860") ? this.sequence-- : (stryCov_9fa48("2860"), this.sequence++),
        executable
      }));
    }
  }

  /**
   * Emit a stream_finished event.
   */
  emitStreamFinished(outcome: "valid" | "truncated" | "salvaged" | "invalid"): void {
    if (stryMutAct_9fa48("2861")) {
      {}
    } else {
      stryCov_9fa48("2861");
      this.enqueue(stryMutAct_9fa48("2862") ? {} : (stryCov_9fa48("2862"), {
        type: stryMutAct_9fa48("2863") ? "" : (stryCov_9fa48("2863"), "stream_finished"),
        sequence: stryMutAct_9fa48("2864") ? this.sequence-- : (stryCov_9fa48("2864"), this.sequence++),
        outcome
      }));
    }
  }

  /**
   * Drain all pending events and clear the queue.
   * Returns a frozen array.
   */
  drain(): readonly ParserEvent[] {
    if (stryMutAct_9fa48("2865")) {
      {}
    } else {
      stryCov_9fa48("2865");
      const events = this.queue;
      this.queue = stryMutAct_9fa48("2866") ? ["Stryker was here"] : (stryCov_9fa48("2866"), []);
      return Object.freeze(events);
    }
  }

  /**
   * Get the number of events emitted during the current push cycle.
   * Call resetPushCount() before push processing.
   */
  private pushEmitCount = 0;
  resetPushCount(): void {
    if (stryMutAct_9fa48("2867")) {
      {}
    } else {
      stryCov_9fa48("2867");
      this.pushEmitCount = 0;
    }
  }
  get emittedDuringPush(): number {
    if (stryMutAct_9fa48("2868")) {
      {}
    } else {
      stryCov_9fa48("2868");
      return this.pushEmitCount;
    }
  }
  private enqueue(event: ParserEvent): void {
    if (stryMutAct_9fa48("2869")) {
      {}
    } else {
      stryCov_9fa48("2869");
      if (stryMutAct_9fa48("2871") ? false : stryMutAct_9fa48("2870") ? true : (stryCov_9fa48("2870", "2871"), this.terminal)) return; // Stop accepting semantic progress, don't report as emitted

      if (stryMutAct_9fa48("2875") ? this.queue.length < this.maxQueued : stryMutAct_9fa48("2874") ? this.queue.length > this.maxQueued : stryMutAct_9fa48("2873") ? false : stryMutAct_9fa48("2872") ? true : (stryCov_9fa48("2872", "2873", "2874", "2875"), this.queue.length >= this.maxQueued)) {
        if (stryMutAct_9fa48("2876")) {
          {}
        } else {
          stryCov_9fa48("2876");
          this.terminal = stryMutAct_9fa48("2877") ? false : (stryCov_9fa48("2877"), true);
          // Emit terminal diagnostic if capacity theoretically permitted (i.e. we just push one more)
          this.queue.push(stryMutAct_9fa48("2878") ? {} : (stryCov_9fa48("2878"), {
            type: stryMutAct_9fa48("2879") ? "" : (stryCov_9fa48("2879"), "diagnostic"),
            sequence: stryMutAct_9fa48("2880") ? this.sequence-- : (stryCov_9fa48("2880"), this.sequence++),
            diagnostic: stryMutAct_9fa48("2881") ? {} : (stryCov_9fa48("2881"), {
              code: stryMutAct_9fa48("2882") ? "" : (stryCov_9fa48("2882"), "E_LIMIT_EVENT_QUEUE"),
              severity: stryMutAct_9fa48("2883") ? "" : (stryCov_9fa48("2883"), "fatal"),
              byteOffset: 0,
              // Event builder doesn't track exact byte offset
              recoverable: stryMutAct_9fa48("2884") ? true : (stryCov_9fa48("2884"), false),
              message: stryMutAct_9fa48("2885") ? "" : (stryCov_9fa48("2885"), "Event queue capacity exceeded")
            })
          }));
          stryMutAct_9fa48("2886") ? this.pushEmitCount-- : (stryCov_9fa48("2886"), this.pushEmitCount++);
          return;
        }
      }
      this.queue.push(event);
      stryMutAct_9fa48("2887") ? this.pushEmitCount-- : (stryCov_9fa48("2887"), this.pushEmitCount++);
    }
  }
}