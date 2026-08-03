// @ts-nocheck
import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
export interface ProviderStreamAdapter<TRawEvent = unknown> {
  readonly provider: ProviderName;
  push(rawEvent: TRawEvent): readonly NormalizedToolStreamEvent[];
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): readonly NormalizedToolStreamEvent[];
}