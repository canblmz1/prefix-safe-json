import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE } from "../coordinator/diagnostic-codes.js";

// Gemini function call shape (structured)
interface GeminiFunctionCall {
  name?: string;
  args?: unknown; // Gemini returns a structured value, not raw JSON argument evidence.
}

interface GeminiPart {
  functionCall?: GeminiFunctionCall;
  // If in future they support streaming raw JSON text, we'd handle it here
  // For now, this is structured.
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

export interface GeminiEvent {
  candidates?: GeminiCandidate[];
}

export class GeminiStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "gemini";
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

    const chunk = rawEvent as GeminiEvent;

    if (Array.isArray(chunk.candidates)) {
      for (const [candidateIndex, candidate] of chunk.candidates.entries()) {
        if (candidate.content && Array.isArray(candidate.content.parts)) {
          for (const [partIndex, part] of candidate.content.parts.entries()) {
            if (part.functionCall) {
              const fc = part.functionCall;
              const sourceKey = `candidate:${candidateIndex}/part:${partIndex}`;
              
              events.push({
                type: "tool_call_start",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                name: fc.name,
              });

              events.push({
                type: "provider_diagnostic",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                code: PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE,
                severity: "warning",
                message: "Gemini function-call arguments are a structured projection, not raw streamed argument evidence",
              });
              
              if (fc.args !== undefined) {
                // Gemini currently emits structured objects.
                // We serialize it to emulate a text delta, BUT it is documented in docs/providers/gemini.md 
                // that this is NOT byte-level streaming. It is object-level final delivery.
                try {
                  const projected = JSON.stringify(fc.args);
                  if (projected === undefined) {
                    throw new TypeError("structured arguments are not JSON-serializable");
                  }
                  events.push({
                    type: "tool_call_arguments_delta",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    delta: projected,
                  });
                } catch {
                  events.push({
                    type: "provider_diagnostic",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    code: "E_GEMINI_ARGUMENT_PROJECTION_FAILED",
                    severity: "error",
                    message: "Gemini structured function-call arguments could not be projected to JSON",
                  });
                }
              }
              
              events.push({
                type: "tool_call_end",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                reason: "complete",
              });
            }
          }
        }
        
        if (candidate.finishReason) {
          let reason: StreamEndReason = "unknown";
          if (candidate.finishReason === "STOP") {
            reason = "complete";
          } else if (candidate.finishReason === "MAX_TOKENS") {
            reason = "length";
          } else if (candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION" || candidate.finishReason === "OTHER") {
            reason = "cancelled";
          }
          
          events.push({
            type: "provider_stream_end",
            sequence: ++this.sequence,
            provider: this.provider,
            reason,
            providerReason: candidate.finishReason,
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
    return [{
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason: meta?.reason ?? "unknown",
      providerReason: meta?.providerReason,
    }];
  }
}
