// ---------------------------------------------------------------------------
// createProviderExecutionGuard — internal composition helper.
//
// Not exported from the package root in this release. Every high-level
// per-provider guard (currently only createAiSdkExecutionGuard) is this
// function applied to one ProviderStreamAdapter instance - no duplicated
// state, no duplicated decision logic, no new parser or coordinator. Kept
// internal (rather than public) until a second provider guard actually
// needs it, per the "don't expose abstraction for its own sake" scoping
// this release deliberately holds to - promoting it to a public export is a
// non-breaking addition whenever that happens.
// ---------------------------------------------------------------------------

import { createToolCallExecutionGate } from "../gate/gate.js";
import { ToolCallExecutionGateFinalResult } from "../gate/types.js";
import { StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "../providers/adapter.js";
import { ExecutionGuard, ExecutionGuardOptions } from "./types.js";

export function createProviderExecutionGuard<TRawEvent>(
  adapter: ProviderStreamAdapter<TRawEvent>,
  options?: ExecutionGuardOptions,
): ExecutionGuard<TRawEvent> {
  const gate = createToolCallExecutionGate(options?.limits, options?.parserOptions, options?.schemas);

  return {
    push(rawEvent: TRawEvent): void {
      for (const normalized of adapter.push(rawEvent)) {
        gate.push(normalized);
      }
    },

    snapshot() {
      return gate.snapshot();
    },

    finish(meta?: { reason?: StreamEndReason; providerReason?: string }): ToolCallExecutionGateFinalResult {
      // If the provider stream already delivered its own terminal event
      // through push() (the common case), the adapter is already
      // `finished` and this is a no-op - meta is only consulted as a
      // fail-closed backstop for a stream that ends without ever reporting
      // why (see ProviderStreamAdapter.finish()'s own contract).
      for (const normalized of adapter.finish(meta)) {
        gate.push(normalized);
      }
      return gate.finish(meta);
    },
  };
}
