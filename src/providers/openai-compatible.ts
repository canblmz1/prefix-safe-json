import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import {
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

interface OpenAIChoiceDelta {
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface OpenAIChoice {
  index?: number;
  delta?: OpenAIChoiceDelta;
  finish_reason?: string | null;
}

export interface OpenAICompatibleEvent {
  choices?: OpenAIChoice[];
}

export class OpenAICompatibleStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openai-compatible";
  private sequence = 0;
  
  // Track full provider coordinates, never the tool index alone.
  private startedSourceKeys: Set<string> = new Set();
  // Keep track of sourceKeys to emit tool_call_end
  private knownSourceKeys: Set<string> = new Set();
  
  private finished = false;

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (this.finished) {
      return [{
        type: "provider_diagnostic",
        sequence: ++this.sequence,
        provider: this.provider,
        code: "W_EVENT_AFTER_STREAM_END",
        severity: "warning",
        message: "Received event after stream finished",
      }];
    }

    const events: NormalizedToolStreamEvent[] = [];
    
    // Narrow unknown
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

    const chunk = rawEvent as OpenAICompatibleEvent;
    
    if (Array.isArray(chunk.choices)) {
      const choiceCounts = new Map<number, number>();
      for (const choice of chunk.choices) {
        if (Number.isInteger(choice.index) && (choice.index as number) >= 0) {
          const choiceIndex = choice.index as number;
          choiceCounts.set(choiceIndex, (choiceCounts.get(choiceIndex) ?? 0) + 1);
        }
      }

      for (const choice of chunk.choices) {
        if (!Number.isInteger(choice.index) || (choice.index as number) < 0) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            code: INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
            severity: "error",
            message: "choice.index is missing, non-integer, or negative; tool-call identity is ambiguous",
          });
          continue;
        }
        const choiceIndex = choice.index as number;
        if ((choiceCounts.get(choiceIndex) ?? 0) > 1) {
          const toolCalls = choice.delta?.tool_calls ?? [];
          if (toolCalls.length === 0) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice.index ${choiceIndex} is duplicated in one provider event`,
            });
          }
          for (const tc of toolCalls) {
            const hasToolIndex = Number.isInteger(tc.index) && tc.index >= 0;
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice.index ${choiceIndex} is duplicated in one provider event`,
              ...(hasToolIndex
                ? { callRef: { sourceKey: `choice:${choiceIndex}/tool-index:${tc.index}` } }
                : {}),
            });
          }
          continue;
        }
        if (choice.delta && Array.isArray(choice.delta.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
             if (!Number.isInteger(tc.index) || tc.index < 0) {
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  code: "E_PROVIDER_EVENT_MALFORMED",
                  severity: "error",
                  message: "tool_call index is missing or invalid",
                });
                continue;
             }
             
             const sourceKey = `choice:${choiceIndex}/tool-index:${tc.index}`;
             this.knownSourceKeys.add(sourceKey);
             
             if (!this.startedSourceKeys.has(sourceKey)) {
                this.startedSourceKeys.add(sourceKey);
                
                events.push({
                  type: "tool_call_start",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  toolIndex: tc.index,
                  toolCallId: tc.id,
                  name: tc.function?.name,
                });
             } else {
                // Send identity if ID provided late
                if (tc.id !== undefined) {
                   events.push({
                     type: "tool_call_identity",
                     sequence: ++this.sequence,
                     provider: this.provider,
                     callRef: { sourceKey },
                     toolCallId: tc.id,
                     toolIndex: tc.index,
                   });
                }
                
                // Name delta
                if (tc.function?.name) {
                  events.push({
                    type: "tool_call_name_delta",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    delta: tc.function.name,
                  });
                }
             }
             
             // Arguments delta
             if (tc.function?.arguments) {
                events.push({
                  type: "tool_call_arguments_delta",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  delta: tc.function.arguments,
                });
             }
          }
        }
        
        if (choice.finish_reason != null) {
          // Stream ending, interpret reason
          let reason: StreamEndReason = "unknown";
          if (choice.finish_reason === "stop" || choice.finish_reason === "tool_calls") {
            reason = "complete";
          } else if (choice.finish_reason === "length") {
            reason = "length";
          } else if (choice.finish_reason === "cancelled") {
            reason = "cancelled";
          }
          
          for (const sourceKey of this.knownSourceKeys.values()) {
            events.push({
              type: "tool_call_end",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey },
              reason: reason,
              providerReason: choice.finish_reason,
            });
          }
          this.knownSourceKeys.clear();

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
    const events: NormalizedToolStreamEvent[] = [];
    for (const sourceKey of this.knownSourceKeys.values()) {
      events.push({
        type: "tool_call_end",
        sequence: ++this.sequence,
        provider: this.provider,
        callRef: { sourceKey },
        reason: meta?.reason ?? "unknown",
        providerReason: meta?.providerReason,
      });
    }
    this.knownSourceKeys.clear();

    events.push({
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason: meta?.reason ?? "unknown",
      providerReason: meta?.providerReason,
    });
    return events;
  }
}
