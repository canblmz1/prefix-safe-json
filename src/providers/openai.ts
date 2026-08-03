import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { OpenAICompatibleStreamAdapter } from "./openai-compatible.js";

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
    if (this.finished) return [];

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
         events.push({
           type: "provider_stream_end",
           sequence: ++this.sequence,
           provider: this.provider,
           reason: "cancelled", // Incomplete treated as cancelled
           providerReason: chunk.response?.status,
         });
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
