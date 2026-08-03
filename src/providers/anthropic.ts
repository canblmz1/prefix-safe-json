import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";

interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta: {
    type: "input_json_delta";
    partial_json: string;
  };
}

interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: {
    type: "tool_use";
    id: string;
    name: string;
  };
}

interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason?: string | null;
  };
}

export type AnthropicEvent =
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | { type: string; [key: string]: unknown };

export class AnthropicStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "anthropic";
  private sequence = 0;
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

    const chunk = rawEvent as {
      type?: string;
      index: number;
      content_block?: { type?: string; id: string; name: string };
      delta?: { type?: string; partial_json: string; stop_reason: string };
    };

    switch (chunk.type) {
      case "content_block_start": {
        if (chunk.content_block?.type === "tool_use") {
          const sourceKey = `content-block:${chunk.index}`;
          
          events.push({
            type: "tool_call_start",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            toolIndex: chunk.index,
            toolCallId: chunk.content_block.id,
            name: chunk.content_block.name,
          });
        }
        break;
      }
      case "content_block_delta": {
        if (chunk.delta?.type === "input_json_delta" && typeof chunk.delta.partial_json === "string") {
          const sourceKey = `content-block:${chunk.index}`;
          events.push({
            type: "tool_call_arguments_delta",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey },
            delta: chunk.delta.partial_json,
          });
        }
        break;
      }
      case "content_block_stop": {
        const sourceKey = `content-block:${chunk.index}`;
        events.push({
          type: "tool_call_end",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey },
          reason: "complete", // Default to complete, message_delta might adjust stream level
        });
        break;
      }
      case "message_delta": {
        if (chunk.delta?.stop_reason) {
          const sr = chunk.delta.stop_reason;
          let reason: StreamEndReason = "unknown";
          if (sr === "end_turn" || sr === "tool_use") {
             reason = "complete";
          } else if (sr === "max_tokens") {
             reason = "length";
          }
          
          events.push({
            type: "provider_stream_end",
            sequence: ++this.sequence,
            provider: this.provider,
            reason,
            providerReason: sr,
          });
          this.finished = true;
        }
        break;
      }
      case "error": {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: "error_event",
        });
        this.finished = true;
        break;
      }
      // Unknown metadata events must not crash the adapter.
      default:
        break;
    }
    
    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    return [{
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason: meta?.reason ?? "unknown",
      providerReason: meta?.providerReason,
    }];
  }
}
