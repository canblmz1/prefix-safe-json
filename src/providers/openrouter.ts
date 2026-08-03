import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { OpenAICompatibleStreamAdapter } from "./openai-compatible.js";

export interface OpenRouterChoice {
  index?: number;
  delta?: {
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
    reasoning?: string;
  };
  finish_reason?: string | null;
  error?: unknown;
}

export interface OpenRouterEvent {
  choices?: OpenRouterChoice[];
  error?: unknown;
}

export class OpenRouterStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openrouter";
  private sequence = 0;
  
  // Delegate standard tool_call formats to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();
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

    const chunk = rawEvent as OpenRouterEvent;
    
    // Check for provider-level errors
    if (chunk.error) {
       events.push({
         type: "provider_diagnostic",
         sequence: ++this.sequence,
         provider: this.provider,
         code: "E_PROVIDER_ERROR",
         severity: "error",
         message: typeof chunk.error === "string" ? chunk.error : JSON.stringify(chunk.error)
       });
       const compatibleEvents = this.compatibleAdapter.finish({ reason: "provider_error", providerReason: "error" });
       for (const e of compatibleEvents) {
          events.push({ ...e, provider: this.provider, sequence: ++this.sequence });
       }
       this.finished = true;
       return events;
    }

    const compatibleEvents = this.compatibleAdapter.push(chunk);
    for (const e of compatibleEvents) {
      events.push({ ...e, provider: this.provider, sequence: ++this.sequence });
    }
    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    
    const compatibleEvents = this.compatibleAdapter.finish(meta);
    return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
  }
}
