import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { OpenAICompatibleStreamAdapter } from "./openai-compatible.js";

export interface OpenRouterChoice {
  index?: number;
  delta?: {
    content?: string | null;
    role?: string;
    tool_calls?: Array<{
      index?: number;
      id?: string;
      type?: string;
      function?: { name?: string; arguments?: string };
    }>;
    reasoning?: string;
  };
  finish_reason?: string | null;
  native_finish_reason?: string | null;
  error?: unknown;
}

export interface OpenRouterEvent {
  choices?: OpenRouterChoice[];
  error?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

// OpenRouter preserves the upstream finish reason separately from its normalized
// reason. A known output-limit signal cannot become successful execution merely
// because the router normalized that choice to `tool_calls` or `stop`.
const NATIVE_OUTPUT_LIMIT_REASONS = new Set(["max_output_tokens", "max_tokens", "MAX_TOKENS", "length"]);

function isAccountingDelta(delta: OpenRouterChoice["delta"]): boolean {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return false;
  return Object.entries(delta).every(([key, value]) =>
    (key === "content" && (value === "" || value === null)) ||
    (key === "role" && value === "assistant"));
}

export class OpenRouterStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openrouter";
  private sequence = 0;
  
  // Delegate standard tool_call formats to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();
  private finished = false;
  // Preserve coordinates unchanged; the compatible adapter owns index validity
  // and duplicate-index diagnostics, even on a stripped accounting terminal.
  private terminalChoices = new Map<number | undefined, { reason: string; nativeReason: string | null }>();
  private accountingTrailerSeen = false;
  private nativeOutputLimitReason: string | undefined;

  private isAccountingTrailer(chunk: OpenRouterEvent): boolean {
    // The documented final usage chunk repeats the exact terminal metadata.
    // Accept one content-free accounting frame only, for already-ended choices.
    // Every other duplicate/conflicting terminal still reaches the strict
    // compatible adapter, including errors, arguments and unknown choice IDs.
    if (this.finished || this.accountingTrailerSeen || !Array.isArray(chunk.choices) || !chunk.choices.length ||
      !chunk.usage || typeof chunk.usage !== "object" || Array.isArray(chunk.usage)) return false;
    const usage = chunk.usage;
    if (![usage.prompt_tokens, usage.completion_tokens, usage.total_tokens]
      .every(value => typeof value === "number" && Number.isFinite(value) && value >= 0)) return false;
    return chunk.choices.every(choice => {
      if (choice.error || !isAccountingDelta(choice.delta)) return false;
      const terminal = this.terminalChoices.get(choice.index);
      return terminal !== undefined && choice.finish_reason === terminal.reason &&
        (choice.native_finish_reason ?? null) === terminal.nativeReason;
    });
  }

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    // No `finished` early return here - see the identical fix and rationale
    // in AnthropicStreamAdapter.push()/OpenAIStreamAdapter.push() (same
    // invariant class as GHSA-3xpw-9694-2xxp). `this.finished` is set on
    // this adapter's own provider-level error shortcut (below) and
    // unconditionally by finish() (a legitimate public lifecycle call, e.g.
    // `finish({reason:"complete"})`) - either way, dropping every push
    // after that point meant a late error/data event never reached the
    // coordinator at all, so an already-decided call's authority could
    // never be revoked by it (proven empirically: reverting this guard
    // alone makes a real post-finish() late `{error:...}` push leave
    // `takeDecision()` returning the full stale execute decision instead of
    // undefined). The normal path already delegates every push to
    // `compatibleAdapter`, which enforces the same invariant on its own
    // `finished` state.
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

    const accounting = this.isAccountingTrailer(chunk);
    if (accounting) this.accountingTrailerSeen = true;
    const choices = Array.isArray(chunk.choices) ? chunk.choices.map(choice => {
      if (choice.finish_reason != null) {
        this.terminalChoices.set(choice.index, { reason: choice.finish_reason, nativeReason: choice.native_finish_reason ?? null });
      }
      if (typeof choice.native_finish_reason === "string" && NATIVE_OUTPUT_LIMIT_REASONS.has(choice.native_finish_reason)) {
        this.nativeOutputLimitReason ??= choice.native_finish_reason;
      }
      return accounting ? { ...choice, finish_reason: null } : choice;
    }) : chunk.choices;
    const compatibleEvents = this.compatibleAdapter.push({ ...chunk, choices });
    for (const e of compatibleEvents) {
      events.push({ ...e, provider: this.provider, sequence: ++this.sequence });
    }
    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    
    // Aggregate native truncation with normalized choice reasons at the actual
    // EOF boundary. Keep the raw reason for evidence instead of inventing a
    // provider finish_reason string. Stronger caller failures retain priority.
    const effectiveMeta = this.nativeOutputLimitReason !== undefined &&
      (meta?.reason === undefined || meta.reason === "complete" || meta.reason === "cancelled" || meta.reason === "length")
      ? { reason: "length" as const, providerReason: this.nativeOutputLimitReason }
      : meta;
    const compatibleEvents = this.compatibleAdapter.finish(effectiveMeta);
    return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
  }
}
