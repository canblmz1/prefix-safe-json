// @ts-nocheck
function stryNS_9fa48() {
  var g = typeof globalThis === 'object' && globalThis && globalThis.Math === Math && globalThis || new Function("return this")();
  var ns = g.__stryker__ || (g.__stryker__ = {});
  if (ns.activeMutant === undefined && g.process && g.process.env && g.process.env.__STRYKER_ACTIVE_MUTANT__) {
    ns.activeMutant = g.process.env.__STRYKER_ACTIVE_MUTANT__;
  }
  function retrieveNS() {
    return ns;
  }
  stryNS_9fa48 = retrieveNS;
  return retrieveNS();
}
stryNS_9fa48();
function stryCov_9fa48() {
  var ns = stryNS_9fa48();
  var cov = ns.mutantCoverage || (ns.mutantCoverage = {
    static: {},
    perTest: {}
  });
  function cover() {
    var c = cov.static;
    if (ns.currentTestId) {
      c = cov.perTest[ns.currentTestId] = cov.perTest[ns.currentTestId] || {};
    }
    var a = arguments;
    for (var i = 0; i < a.length; i++) {
      c[a[i]] = (c[a[i]] || 0) + 1;
    }
  }
  stryCov_9fa48 = cover;
  cover.apply(null, arguments);
}
function stryMutAct_9fa48(id) {
  var ns = stryNS_9fa48();
  function isActive(id) {
    if (ns.activeMutant === id) {
      if (ns.hitCount !== void 0 && ++ns.hitCount > ns.hitLimit) {
        throw new Error('Stryker: Hit count limit reached (' + ns.hitCount + ')');
      }
      return true;
    }
    return false;
  }
  stryMutAct_9fa48 = isActive;
  return isActive(id);
}
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
      function?: {
        name?: string;
        arguments?: string;
      };
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
  readonly provider: ProviderName = stryMutAct_9fa48("2783") ? "" : (stryCov_9fa48("2783"), "openrouter");
  private sequence = 0;

  // Delegate standard tool_call formats to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();
  private finished = stryMutAct_9fa48("2784") ? true : (stryCov_9fa48("2784"), false);
  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2785")) {
      {}
    } else {
      stryCov_9fa48("2785");
      if (stryMutAct_9fa48("2787") ? false : stryMutAct_9fa48("2786") ? true : (stryCov_9fa48("2786", "2787"), this.finished)) return stryMutAct_9fa48("2788") ? ["Stryker was here"] : (stryCov_9fa48("2788"), []);
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2789") ? ["Stryker was here"] : (stryCov_9fa48("2789"), []);
      if (stryMutAct_9fa48("2792") ? !rawEvent && typeof rawEvent !== "object" : stryMutAct_9fa48("2791") ? false : stryMutAct_9fa48("2790") ? true : (stryCov_9fa48("2790", "2791", "2792"), (stryMutAct_9fa48("2793") ? rawEvent : (stryCov_9fa48("2793"), !rawEvent)) || (stryMutAct_9fa48("2795") ? typeof rawEvent === "object" : stryMutAct_9fa48("2794") ? false : (stryCov_9fa48("2794", "2795"), typeof rawEvent !== (stryMutAct_9fa48("2796") ? "" : (stryCov_9fa48("2796"), "object")))))) {
        if (stryMutAct_9fa48("2797")) {
          {}
        } else {
          stryCov_9fa48("2797");
          events.push(stryMutAct_9fa48("2798") ? {} : (stryCov_9fa48("2798"), {
            type: stryMutAct_9fa48("2799") ? "" : (stryCov_9fa48("2799"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2800") ? --this.sequence : (stryCov_9fa48("2800"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2801") ? "" : (stryCov_9fa48("2801"), "E_PROVIDER_EVENT_MALFORMED"),
            severity: stryMutAct_9fa48("2802") ? "" : (stryCov_9fa48("2802"), "error"),
            message: stryMutAct_9fa48("2803") ? "" : (stryCov_9fa48("2803"), "Raw event is not an object")
          }));
          return events;
        }
      }
      const chunk = rawEvent as OpenRouterEvent;

      // Check for provider-level errors
      if (stryMutAct_9fa48("2805") ? false : stryMutAct_9fa48("2804") ? true : (stryCov_9fa48("2804", "2805"), chunk.error)) {
        if (stryMutAct_9fa48("2806")) {
          {}
        } else {
          stryCov_9fa48("2806");
          events.push(stryMutAct_9fa48("2807") ? {} : (stryCov_9fa48("2807"), {
            type: stryMutAct_9fa48("2808") ? "" : (stryCov_9fa48("2808"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2809") ? --this.sequence : (stryCov_9fa48("2809"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2810") ? "" : (stryCov_9fa48("2810"), "E_PROVIDER_ERROR"),
            severity: stryMutAct_9fa48("2811") ? "" : (stryCov_9fa48("2811"), "error"),
            message: (stryMutAct_9fa48("2814") ? typeof chunk.error !== "string" : stryMutAct_9fa48("2813") ? false : stryMutAct_9fa48("2812") ? true : (stryCov_9fa48("2812", "2813", "2814"), typeof chunk.error === (stryMutAct_9fa48("2815") ? "" : (stryCov_9fa48("2815"), "string")))) ? chunk.error : JSON.stringify(chunk.error)
          }));
          const compatibleEvents = this.compatibleAdapter.finish(stryMutAct_9fa48("2816") ? {} : (stryCov_9fa48("2816"), {
            reason: stryMutAct_9fa48("2817") ? "" : (stryCov_9fa48("2817"), "provider_error"),
            providerReason: stryMutAct_9fa48("2818") ? "" : (stryCov_9fa48("2818"), "error")
          }));
          for (const e of compatibleEvents) {
            if (stryMutAct_9fa48("2819")) {
              {}
            } else {
              stryCov_9fa48("2819");
              events.push(stryMutAct_9fa48("2820") ? {} : (stryCov_9fa48("2820"), {
                ...e,
                provider: this.provider,
                sequence: stryMutAct_9fa48("2821") ? --this.sequence : (stryCov_9fa48("2821"), ++this.sequence)
              }));
            }
          }
          this.finished = stryMutAct_9fa48("2822") ? false : (stryCov_9fa48("2822"), true);
          return events;
        }
      }
      const compatibleEvents = this.compatibleAdapter.push(chunk);
      for (const e of compatibleEvents) {
        if (stryMutAct_9fa48("2823")) {
          {}
        } else {
          stryCov_9fa48("2823");
          events.push(stryMutAct_9fa48("2824") ? {} : (stryCov_9fa48("2824"), {
            ...e,
            provider: this.provider,
            sequence: stryMutAct_9fa48("2825") ? --this.sequence : (stryCov_9fa48("2825"), ++this.sequence)
          }));
        }
      }
      return events;
    }
  }
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2826")) {
      {}
    } else {
      stryCov_9fa48("2826");
      if (stryMutAct_9fa48("2828") ? false : stryMutAct_9fa48("2827") ? true : (stryCov_9fa48("2827", "2828"), this.finished)) return stryMutAct_9fa48("2829") ? ["Stryker was here"] : (stryCov_9fa48("2829"), []);
      this.finished = stryMutAct_9fa48("2830") ? false : (stryCov_9fa48("2830"), true);
      const compatibleEvents = this.compatibleAdapter.finish(meta);
      return compatibleEvents.map(stryMutAct_9fa48("2831") ? () => undefined : (stryCov_9fa48("2831"), e => stryMutAct_9fa48("2832") ? {} : (stryCov_9fa48("2832"), {
        ...e,
        provider: this.provider,
        sequence: stryMutAct_9fa48("2833") ? --this.sequence : (stryCov_9fa48("2833"), ++this.sequence)
      })));
    }
  }
}