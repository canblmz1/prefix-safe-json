import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { OpenAICompatibleStreamAdapter } from "./openai-compatible.js";
import { CONTENT_FILTERED_DIAGNOSTIC_CODE } from "../coordinator/diagnostic-codes.js";

interface OpenAIFunctionCallDelta {
  name?: string;
  arguments?: string;
}

interface OpenAIChoice {
  delta?: {
    function_call?: OpenAIFunctionCallDelta;
    tool_calls?: unknown;
  };
  finish_reason?: string | null;
}

export interface OpenAIEvent {
  choices?: OpenAIChoice[];
  type?: string;
  output_index?: number;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  item_id?: string;
  delta?: string;
  arguments?: string;
  response?: {
    status?: string;
    // Only populated when status is "incomplete". Confirmed against the
    // openai-node SDK's Response type: exactly "max_output_tokens" or
    // "content_filter" today - any other string is a future/unrecognized
    // value we haven't been taught to classify yet.
    incomplete_details?: {
      reason?: string;
    };
    // Only populated when status is "failed" (response.failed event).
    error?: {
      code?: string;
      message?: string;
    } | null;
  };
}

export class OpenAIStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openai";
  private sequence = 0;
  
  // Delegating tool_calls format to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();
  
  // For function_call (legacy)
  private hasLegacyFunctionCall = false;
  private legacySourceKey = "legacy-function-call";
  
  // For Responses API
  private accumulatedArguments = new Map<string, string>();
  private receivedDeltas = new Set<string>();
  
  private finished = false;

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    // No `finished` early return here: silently dropping every event after
    // the first terminal meant a late argument delta, a conflicting or
    // duplicate finish, or a provider error that arrived even one raw event
    // late never reached the coordinator at all - not even as a diagnostic -
    // so an already-decided call's authority could never be revoked by it.
    // Every case below that has ITS OWN meaningful post-terminal handling
    // (a genuine argument delta, a second output_item.added, a second
    // stream-terminal) still fires exactly as if the stream were open; the
    // coordinator's own `isFinished` gate (coordinator.ts's `push()`) is
    // what turns each of those into a sticky, stream-wide
    // AUTHORITY_PROTOCOL_VIOLATION_CODES diagnostic once it actually
    // receives them. Mirrors the fix already applied to AiSdkStreamAdapter
    // for the same invariant (GHSA-3xpw-9694-2xxp).
    const events: NormalizedToolStreamEvent[] = [];

    if (!rawEvent || typeof rawEvent !== "object") {
      events.push({
        type: "provider_diagnostic",
        sequence: ++this.sequence,
        provider: this.provider,
        code: "E_PROVIDER_EVENT_MALFORMED",
        severity: "error",
        message: "Raw event is not an object",
      });
      return events;
    }

    const chunk = rawEvent as OpenAIEvent;
    
    // Handle Responses API
    if (chunk.type?.startsWith("response.") || chunk.type === "error") {
      if (chunk.type === "error") {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: "error",
        });
        this.finished = true;
        return events;
      }

      if (chunk.type === "response.failed") {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: chunk.response?.error?.code ?? "response.failed",
        });
        this.finished = true;
        return events;
      }

      if (chunk.type === "response.output_item.added" && chunk.item?.type === "function_call" && chunk.item.id) {
        events.push({
          type: "tool_call_start",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey: `output-item:${chunk.item.id}` },
          toolCallId: chunk.item.call_id,
          name: chunk.item.name,
        });
      } else if (chunk.type === "response.function_call_arguments.delta" && chunk.item_id && chunk.delta) {
        this.receivedDeltas.add(chunk.item_id);
        const acc = this.accumulatedArguments.get(chunk.item_id) ?? "";
        this.accumulatedArguments.set(chunk.item_id, acc + chunk.delta);
        
        events.push({
          type: "tool_call_arguments_delta",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey: `output-item:${chunk.item_id}` },
          delta: chunk.delta,
        });
      } else if (chunk.type === "response.function_call_arguments.done" && chunk.item_id && chunk.arguments !== undefined) {
        const acc = this.accumulatedArguments.get(chunk.item_id) ?? "";
        const hasDeltas = this.receivedDeltas.has(chunk.item_id);
        
        if (!hasDeltas && chunk.arguments.length > 0) {
          // No deltas, just final arguments.
          events.push({
            type: "tool_call_arguments_delta",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey: `output-item:${chunk.item_id}` },
            delta: chunk.arguments,
          });
          this.accumulatedArguments.set(chunk.item_id, chunk.arguments);
        } else if (hasDeltas && chunk.arguments !== acc) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey: `output-item:${chunk.item_id}` },
            code: "E_FINAL_ARGUMENTS_CONFLICT",
            severity: "error",
            message: "Final arguments do not match accumulated deltas",
          });
        }
      } else if (chunk.type === "response.output_item.done" && chunk.item?.id) {
         events.push({
           type: "tool_call_end",
           sequence: ++this.sequence,
           provider: this.provider,
           callRef: { sourceKey: `output-item:${chunk.item.id}` },
           reason: "complete", // Default complete for item done
         });
      } else if (chunk.type === "response.completed") {
         events.push({
           type: "provider_stream_end",
           sequence: ++this.sequence,
           provider: this.provider,
           reason: "complete",
           providerReason: chunk.response?.status,
         });
         this.finished = true;
      } else if (chunk.type === "response.incomplete") {
         const incompleteReason = chunk.response?.incomplete_details?.reason;
         if (incompleteReason === "max_output_tokens") {
           // An explicit provider-native output-budget signal: a positively
           // observed truncation, not a generic cancellation. Any call still
           // "collecting" when this arrives must fail closed even if its own
           // JSON happens to look syntactically complete (see isExecutable()
           // in parser.ts) - a coincidentally-closed value from a stream the
           // provider itself says it cut short is not confirmation of intent.
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "length",
             providerReason: incompleteReason,
           });
         } else if (incompleteReason === "content_filter") {
           // A policy/safety termination, not a retryable interruption:
           // recorded as its own diagnostic so the execution gate rejects
           // with "content_filtered" instead of the generic "stream_incomplete"
           // a bare "cancelled" end reason would otherwise produce. Mirrors
           // the same finish_reason === "content-filter" handling in
           // ai-sdk.ts.
           events.push({
             type: "provider_diagnostic",
             sequence: ++this.sequence,
             provider: this.provider,
             code: CONTENT_FILTERED_DIAGNOSTIC_CODE,
             severity: "error",
             message: "Generation stopped by the model provider's content filter",
           });
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "cancelled",
             providerReason: incompleteReason,
           });
         } else {
           // incomplete_details missing, or a reason string this adapter
           // doesn't recognize (e.g. a future OpenAI addition): fail closed
           // on "unknown" rather than mislabeling it as "cancelled", which
           // would wrongly imply a user/API-initiated cancellation instead
           // of an unclassified provider-side termination.
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "unknown",
             providerReason: incompleteReason ?? chunk.response?.status,
           });
         }
         this.finished = true;
      }
      return events;
    }

    // Check if it's the standard tool_calls format
    if (chunk.choices?.[0]?.delta?.tool_calls !== undefined) {
      // Delegate to OpenAICompatibleStreamAdapter
      const compatibleEvents = this.compatibleAdapter.push(rawEvent);
      // Map provider name to "openai"
      return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
    }

    // Handle legacy function_call format
    if (Array.isArray(chunk.choices)) {
      for (const choice of chunk.choices) {
        if (choice.delta?.function_call) {
          const fc = choice.delta.function_call;
          if (!this.hasLegacyFunctionCall) {
            this.hasLegacyFunctionCall = true;
            events.push({
              type: "tool_call_start",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: this.legacySourceKey },
              toolIndex: 0,
              name: fc.name,
            });
          } else if (fc.name) {
            events.push({
              type: "tool_call_name_delta",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: this.legacySourceKey },
              delta: fc.name,
            });
          }
          
          if (fc.arguments) {
            events.push({
              type: "tool_call_arguments_delta",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: this.legacySourceKey },
              delta: fc.arguments,
            });
          }
        }
        
        if (choice.finish_reason != null) {
          let reason: StreamEndReason = "unknown";
          if (choice.finish_reason === "stop" || choice.finish_reason === "function_call" || choice.finish_reason === "tool_calls") {
            reason = "complete";
          } else if (choice.finish_reason === "length") {
            reason = "length";
          } else if (choice.finish_reason === "cancelled") {
            reason = "cancelled";
          }
          
          events.push({
            type: "provider_stream_end",
            sequence: ++this.sequence,
            provider: this.provider,
            reason,
            providerReason: choice.finish_reason,
          });
          this.finished = true;
        }
      }
    }
    
    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    
    const compatibleEvents = this.compatibleAdapter.finish(meta);
    if (compatibleEvents.length > 0 && !this.hasLegacyFunctionCall) {
       return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
    }

    return [{
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason: meta?.reason ?? "unknown",
      providerReason: meta?.providerReason,
    }];
  }
}
