import { IncrementalJsonParser } from "../types.js";
import { createParser } from "../parser.js";
import { NormalizedToolStreamEvent, ProviderName, StreamEndReason } from "./protocol.js";
import {
  ToolCallStreamCoordinator,
  ToolCallCoordinatorSnapshot,
  ToolCallCoordinatorEvent,
  ToolCallCoordinatorFinalResult,
  CoordinatorPushResult,
  CoordinatorLimits,
  DEFAULT_COORDINATOR_LIMITS,
  ToolCallState,
  CoordinatorDiagnostic
} from "./types.js";

class CoordinatorCallState {
  readonly internalId: string;
  readonly provider: ProviderName;
  
  toolCallId?: string;
  toolIndex?: number;
  
  name?: string;
  nameComplete: boolean = false;
  argumentStreamClosed: boolean = false;
  
  readonly parser: IncrementalJsonParser;
  
  status: ToolCallState["status"] = "collecting";
  
  constructor(internalId: string, provider: ProviderName, parser: IncrementalJsonParser) {
    this.internalId = internalId;
    this.provider = provider;
    this.parser = parser;
  }
}

export class DefaultToolCallStreamCoordinator implements ToolCallStreamCoordinator {
  private readonly limits: CoordinatorLimits;
  private calls: Map<string, CoordinatorCallState> = new Map();
  private sourceKeyToInternalId: Map<string, string> = new Map();
  private callCounter = 0;
  private eventQueue: ToolCallCoordinatorEvent[] = [];
  private diagnostics: CoordinatorDiagnostic[] = [];
  private eventsProcessed = 0;
  private globalSequence = 0;
  private isFinished = false;
  
  constructor(limits?: Partial<CoordinatorLimits>) {
    this.limits = { ...DEFAULT_COORDINATOR_LIMITS, ...limits };
  }

  push(event: NormalizedToolStreamEvent): CoordinatorPushResult {
    if (this.isFinished) {
      this.addDiagnostic({
        code: "E_EVENT_AFTER_STREAM_END",
        severity: "error",
        message: "Event pushed after stream end",
      });
      return { accepted: false };
    }

    if (this.eventsProcessed >= this.limits.maxNormalizedEvents) {
      this.addDiagnostic({
        code: "E_COORDINATOR_LIMIT_EVENTS",
        severity: "fatal",
        message: "Maximum normalized events exceeded",
      });
      return { accepted: false };
    }

    this.eventsProcessed++;

    switch (event.type) {
      case "tool_call_start":
        this.handleStart(event);
        break;
      case "tool_call_identity":
        this.handleIdentity(event);
        break;
      case "tool_call_name_delta":
        this.handleNameDelta(event);
        break;
      case "tool_call_arguments_delta":
        this.handleArgumentsDelta(event);
        break;
      case "tool_call_end":
        this.handleCallEnd(event);
        break;
      case "provider_diagnostic":
        this.handleProviderDiagnostic(event);
        break;
      case "provider_stream_end":
        this.handleStreamEnd(event);
        break;
    }

    return { accepted: true };
  }

  private handleStart(event: NormalizedToolStreamEvent & { type: "tool_call_start" }) {
    const sourceKey = event.callRef.sourceKey;
    
    const existingId = this.sourceKeyToInternalId.get(sourceKey);
    if (existingId !== undefined) {
      this.addDiagnostic({
        code: "E_DUPLICATE_TOOL_CALL_START",
        severity: "error",
        internalId: existingId,
        message: `Duplicate start for tool call sourceKey: ${sourceKey}`,
      });
      return;
    }

    if (this.calls.size >= this.limits.maxToolCalls) {
      this.addDiagnostic({
        code: "E_COORDINATOR_LIMIT_CALLS",
        severity: "error",
        message: "Maximum tool calls exceeded",
      });
      return;
    }

    const internalId = `call-${this.callCounter++}`;
    this.sourceKeyToInternalId.set(sourceKey, internalId);

    const parser = createParser(); // Using default parser limits for now
    const call = new CoordinatorCallState(internalId, event.provider, parser);
    
    if (event.toolCallId !== undefined) call.toolCallId = event.toolCallId;
    if (event.toolIndex !== undefined) call.toolIndex = event.toolIndex;
    if (event.name !== undefined) call.name = event.name;

    this.calls.set(internalId, call);
    
    this.eventQueue.push({
      type: "tool_call_discovered",
      sequence: this.globalSequence++,
      internalId,
      provider: event.provider,
    });
    
    if (event.toolCallId !== undefined || event.toolIndex !== undefined) {
      this.eventQueue.push({
        type: "tool_call_identity_updated",
        sequence: this.globalSequence++,
        internalId,
        toolCallId: event.toolCallId,
        toolIndex: event.toolIndex,
      });
    }
  }

  private handleIdentity(event: NormalizedToolStreamEvent & { type: "tool_call_identity" }) {
    const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
    if (!internalId) return;
    const call = this.getCall(internalId);
    if (!call) return;

    let changed = false;
    if (event.toolCallId !== undefined) {
      if (call.toolCallId !== undefined && call.toolCallId !== event.toolCallId) {
        this.addDiagnostic({
          code: "E_PROVIDER_IDENTITY_CONFLICT",
          severity: "error",
          internalId: call.internalId,
          message: `Conflicting ID: had ${call.toolCallId}, got ${event.toolCallId}`,
        });
        call.status = "invalid";
      } else if (call.toolCallId === undefined) {
        call.toolCallId = event.toolCallId;
        changed = true;
      }
    }

    if (event.toolIndex !== undefined) {
      if (call.toolIndex !== undefined && call.toolIndex !== event.toolIndex) {
        this.addDiagnostic({
          code: "E_PROVIDER_INDEX_CONFLICT",
          severity: "error",
          internalId: call.internalId,
          message: `Conflicting index: had ${call.toolIndex}, got ${event.toolIndex}`,
        });
        call.status = "invalid";
      } else if (call.toolIndex === undefined) {
        call.toolIndex = event.toolIndex;
        changed = true;
      }
    }

    if (changed) {
      this.eventQueue.push({
        type: "tool_call_identity_updated",
        sequence: this.globalSequence++,
        internalId: call.internalId,
        toolCallId: call.toolCallId,
        toolIndex: call.toolIndex,
      });
    }
  }

  private handleNameDelta(event: NormalizedToolStreamEvent & { type: "tool_call_name_delta" }) {
    const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
    if (!internalId) return;
    const call = this.getCall(internalId);
    if (!call) return;

    if (call.status !== "collecting") {
      this.addDiagnostic({
        code: "E_NAME_DELTA_AFTER_END",
        severity: "error",
        internalId: call.internalId,
        message: "Name delta after call ended",
      });
      return;
    }

    call.name = (call.name ?? "") + event.delta;

    if (call.name.length > this.limits.maxToolNameBytes) {
      this.addDiagnostic({
        code: "E_TOOL_NAME_LIMIT",
        severity: "error",
        internalId: call.internalId,
        message: "Tool name exceeded maximum length",
      });
      call.status = "invalid";
    }

    this.eventQueue.push({
      type: "tool_name_updated",
      sequence: event.sequence,
      internalId: call.internalId,
      name: call.name,
      complete: false,
    });
  }

  private handleArgumentsDelta(event: NormalizedToolStreamEvent & { type: "tool_call_arguments_delta" }) {
    const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
    if (!internalId) return;
    const call = this.getCall(internalId);
    if (!call) return;

    if (call.status !== "collecting") {
      this.addDiagnostic({
        code: "E_ARGUMENT_DELTA_AFTER_END",
        severity: "error",
        internalId: call.internalId,
        message: "Argument delta after call ended",
      });
      return;
    }

    call.parser.push(event.delta);
    
    // Drain parser events and map them to coordinator events
    const parserEvents = call.parser.drainEvents();
    for (const pe of parserEvents) {
      this.eventQueue.push({
        type: "tool_argument_event",
        sequence: this.globalSequence++,
        internalId: call.internalId,
        event: pe,
      });
    }
  }

  private handleCallEnd(event: NormalizedToolStreamEvent & { type: "tool_call_end" }) {
    const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
    if (!internalId) return;
    const call = this.getCall(internalId);
    if (!call) return;

    if (call.status !== "collecting") return;

    call.nameComplete = true;
    call.argumentStreamClosed = true;
    
    if (call.name !== undefined) {
      this.eventQueue.push({
        type: "tool_name_updated",
        sequence: this.globalSequence++,
        internalId: call.internalId,
        name: call.name,
        complete: true,
      });
    } else {
       this.addDiagnostic({
        code: "E_TOOL_NAME_MISSING",
        severity: "error",
        internalId: call.internalId,
        message: "Tool name missing at end",
      });
    }
  }

  private finishCall(call: CoordinatorCallState, reason: StreamEndReason) {
    if (call.status !== "collecting") return;
    
    // For individual call end, we pass reason to the internal parser
    const res = call.parser.finish({ reason });
    
    // Determine the mapped coordinator outcome
    let outcome: ToolCallState["status"] = "invalid";
    if (res.outcome === "valid") {
       outcome = "complete";
       if (call.name === undefined || this.hasCallConflict(call)) {
          outcome = "invalid";
       }
    } else if (res.outcome === "truncated") {
       outcome = "truncated";
    } else if (res.outcome === "salvaged") {
       outcome = "salvaged";
    }

    if (reason === "cancelled") outcome = "cancelled";

    call.status = outcome;

    // Drain remaining parser events
    const parserEvents = call.parser.drainEvents();
    for (const pe of parserEvents) {
      this.eventQueue.push({
        type: "tool_argument_event",
        sequence: this.globalSequence++,
        internalId: call.internalId,
        event: pe,
      });
    }

    // Determine executable according to Executable Policy
    const executable = outcome === "complete" && res.executable;

    this.eventQueue.push({
      type: "tool_call_finished",
      sequence: this.globalSequence++,
      internalId: call.internalId,
      outcome,
      executable,
    });
  }
  
  private hasCallConflict(call: CoordinatorCallState): boolean {
    return this.diagnostics.some(d => d.internalId === call.internalId && (d.severity === "error" || d.severity === "fatal"));
  }

  private handleProviderDiagnostic(event: NormalizedToolStreamEvent & { type: "provider_diagnostic" }) {
    const internalId = event.callRef ? this.sourceKeyToInternalId.get(event.callRef.sourceKey) : undefined;
    this.addDiagnostic({
      code: event.code,
      severity: event.severity,
      message: event.message,
      internalId,
    });
  }

  private handleStreamEnd(event: NormalizedToolStreamEvent & { type: "provider_stream_end" }) {
    this.isFinished = true;
    
    // Close all open calls
    for (const call of this.calls.values()) {
      if (call.status === "collecting") {
        if (!call.argumentStreamClosed) {
          this.addDiagnostic({
            code: "E_STREAM_ENDED_WITH_OPEN_CALL",
            severity: "error",
            internalId: call.internalId,
            message: "Stream ended with open call",
          });
        }
        this.finishCall(call, event.reason);
      }
    }

    this.eventQueue.push({
      type: "provider_stream_finished",
      sequence: this.globalSequence++,
      reason: event.reason,
    });
  }

  private getCall(internalId: string): CoordinatorCallState | undefined {
    const call = this.calls.get(internalId);
    if (!call) {
      this.addDiagnostic({
        code: "E_TOOL_CALL_NOT_FOUND",
        severity: "error",
        internalId,
        message: `Tool call ${internalId} not found`,
      });
      return undefined;
    }
    return call;
  }

  private addDiagnostic(diag: CoordinatorDiagnostic) {
    this.diagnostics.push(diag);
    this.eventQueue.push({
      type: "coordinator_diagnostic",
      sequence: this.globalSequence++,
      diagnostic: diag,
    });
  }

  snapshot(): ToolCallCoordinatorSnapshot {
    return {
      calls: Array.from(this.calls.values()).map((c) => ({
        internalId: c.internalId,
        provider: c.provider,
        toolCallId: c.toolCallId,
        toolIndex: c.toolIndex,
        name: c.name,
        nameComplete: c.nameComplete,
        parser: c.parser.snapshot(),
        status: c.status,
      })),
      diagnostics: [...this.diagnostics],
      eventsProcessed: this.eventsProcessed,
      isFinished: this.isFinished,
    };
  }

  drainEvents(): readonly ToolCallCoordinatorEvent[] {
    const events = this.eventQueue;
    this.eventQueue = [];
    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): ToolCallCoordinatorFinalResult {
    if (!this.isFinished) {
      this.handleStreamEnd({
        type: "provider_stream_end",
        sequence: this.eventsProcessed + 1,
        provider: "unknown",
        reason: meta?.reason ?? "unknown",
        providerReason: meta?.providerReason,
      });
    }
    return {
      calls: this.snapshot().calls,
    };
  }
}

export function createToolCallStreamCoordinator(limits?: Partial<CoordinatorLimits>): ToolCallStreamCoordinator {
  return new DefaultToolCallStreamCoordinator(limits);
}
