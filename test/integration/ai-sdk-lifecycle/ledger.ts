/**
 * A fake irreversible operation with a durable event log, shared by every
 * real-lifecycle AI SDK integration test. Deliberately provider-agnostic -
 * nothing here imports `ai`, `ai-v5`, `ai-v6`, or `ai-v7`.
 */
export interface LedgerEvent {
  readonly toolCallId: string;
  readonly args: unknown;
}

export class OperationLedger {
  private events: LedgerEvent[] = [];

  /** The real, irreversible side effect under test. Never call this speculatively. */
  execute(toolCallId: string, args: unknown): { ok: true } {
    this.events.push({ toolCallId, args });
    return { ok: true };
  }

  get count(): number {
    return this.events.length;
  }

  get log(): readonly LedgerEvent[] {
    return this.events;
  }

  reset(): void {
    this.events = [];
  }
}
