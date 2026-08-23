import { Ajv, ValidateFunction } from "ajv";
import { IncrementalJsonParser, ParserOptions } from "../types.js";
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
  CoordinatorDiagnostic,
  JsonSchemaLike
} from "./types.js";
import {
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
} from "./diagnostic-codes.js";

// A `provider_diagnostic` carrying either code is proof that a provider SDK's
// own tool loop already invoked this call's `execute` callback (see the two
// constants' own docs in diagnostic-codes.ts) - success and failure get
// identical treatment here, since neither proves the absence of a partial
// irreversible side effect, and this library only needs to know that
// execution authority already left its hands.
const SDK_EXECUTION_OBSERVED_CODES: ReadonlySet<string> = new Set([
  SDK_EXECUTION_OBSERVED_DIAGNOSTIC_CODE,
  SDK_EXECUTION_ERROR_DIAGNOSTIC_CODE,
]);

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
  schemaValid?: boolean;

  constructor(internalId: string, provider: ProviderName, parser: IncrementalJsonParser) {
    this.internalId = internalId;
    this.provider = provider;
    this.parser = parser;
  }
}

export class DefaultToolCallStreamCoordinator implements ToolCallStreamCoordinator {
  private readonly limits: CoordinatorLimits;
  private readonly parserOptions: ParserOptions | undefined;
  private readonly toolValidators: Map<string, ValidateFunction>;
  private calls: Map<string, CoordinatorCallState> = new Map();
  private sourceKeyToInternalId: Map<string, string> = new Map();
  private callCounter = 0;
  private eventQueue: ToolCallCoordinatorEvent[] = [];
  private diagnostics: CoordinatorDiagnostic[] = [];
  private eventsProcessed = 0;
  private globalSequence = 0;
  private isFinished = false;

  /**
   * @param limits Coordinator-level limits (concurrent tool calls, tool name
   *   size, etc.) — distinct from `parserOptions`, which configures each
   *   underlying per-call IncrementalJsonParser (limits, repairs). Previously
   *   there was no way to pass the latter through at all; every parser the
   *   coordinator created was hardcoded to library defaults.
   * @param toolSchemas Optional JSON Schema (draft-07) per tool name. When a
   *   call for a registered tool reaches outcome "complete", its
   *   `stableValue` is validated against the schema. Structural
   *   prefix-safety (no truncated/fabricated values) and schema validity
   *   are independent concerns — a value can be genuinely complete and
   *   still not match what the tool declared it needs (wrong type, missing
   *   required field the model never provided at all). Both must hold for
   *   `executable` to be true. Schemas are compiled eagerly here so a
   *   malformed schema fails fast at construction, not mid-stream.
   */
  constructor(
    limits?: Partial<CoordinatorLimits>,
    parserOptions?: ParserOptions,
    toolSchemas?: Record<string, JsonSchemaLike>,
  ) {
    this.limits = { ...DEFAULT_COORDINATOR_LIMITS, ...limits };
    this.parserOptions = parserOptions;
    this.toolValidators = new Map();
    if (toolSchemas) {
      const ajv = new Ajv({ allErrors: true, strict: false });
      for (const [toolName, schema] of Object.entries(toolSchemas)) {
        this.toolValidators.set(toolName, ajv.compile(schema));
      }
    }
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

    const parser = createParser(this.parserOptions);
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

    // Schema validation is a separate concern from structural
    // prefix-safety: only meaningful once the value is genuinely complete,
    // and only for tools with a registered schema.
    if (outcome === "complete" && call.name !== undefined) {
      const validator = this.toolValidators.get(call.name);
      if (validator) {
        call.schemaValid = validator(res.stableValue) === true;
        if (!call.schemaValid) {
          const errors = (validator.errors ?? [])
            .map((e) => `${e.instancePath || "<root>"} ${e.message ?? ""}`.trim())
            .join("; ");
          this.addDiagnostic({
            code: "E_SCHEMA_VALIDATION_FAILED",
            severity: "error",
            internalId: call.internalId,
            message: `Tool call arguments for "${call.name}" do not match its schema: ${errors || "unknown validation error"}`,
          });
        }
      }
    }

    // Determine executable according to Executable Policy — structural
    // completeness AND (if a schema is registered) schema validity.
    const executable = outcome === "complete" && res.executable && call.schemaValid !== false;

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

    // Mirrors handleIdentity()'s existing "mutate call.status mid-stream, not
    // only at finishCall() time" pattern for identity conflicts - this is
    // the same kind of call-scoped fact that can be known before the stream
    // ends and must not wait for it. Gated on "collecting" (first write
    // wins, matching finishCall()'s own `if (call.status !== "collecting")
    // return` guard) so this is a one-way transition: once set, no later
    // event of any kind - including a duplicate of this same diagnostic -
    // can move the call off "sdk_execution_observed". An unattributable
    // diagnostic (no callRef, e.g. a malformed provider event with no
    // correlatable ID) intentionally poisons nothing - there is no specific
    // call to hold ineligible, and guessing one would be worse than leaving
    // it to decide normally.
    if (internalId !== undefined && SDK_EXECUTION_OBSERVED_CODES.has(event.code)) {
      const call = this.calls.get(internalId);
      if (call && call.status === "collecting") {
        call.status = "sdk_execution_observed";
      }
    }
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
        schemaValid: c.schemaValid,
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

export function createToolCallStreamCoordinator(
  limits?: Partial<CoordinatorLimits>,
  parserOptions?: ParserOptions,
  toolSchemas?: Record<string, JsonSchemaLike>,
): ToolCallStreamCoordinator {
  return new DefaultToolCallStreamCoordinator(limits, parserOptions, toolSchemas);
}
