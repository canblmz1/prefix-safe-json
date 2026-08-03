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
export type AnthropicEvent = AnthropicContentBlockStartEvent | AnthropicContentBlockDeltaEvent | AnthropicContentBlockStopEvent | AnthropicMessageDeltaEvent | {
  type: string;
  [key: string]: unknown;
};
export class AnthropicStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = stryMutAct_9fa48("2170") ? "" : (stryCov_9fa48("2170"), "anthropic");
  private sequence = 0;
  private finished = stryMutAct_9fa48("2171") ? true : (stryCov_9fa48("2171"), false);
  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2172")) {
      {}
    } else {
      stryCov_9fa48("2172");
      if (stryMutAct_9fa48("2174") ? false : stryMutAct_9fa48("2173") ? true : (stryCov_9fa48("2173", "2174"), this.finished)) return stryMutAct_9fa48("2175") ? ["Stryker was here"] : (stryCov_9fa48("2175"), []);
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2176") ? ["Stryker was here"] : (stryCov_9fa48("2176"), []);
      if (stryMutAct_9fa48("2179") ? !rawEvent && typeof rawEvent !== "object" : stryMutAct_9fa48("2178") ? false : stryMutAct_9fa48("2177") ? true : (stryCov_9fa48("2177", "2178", "2179"), (stryMutAct_9fa48("2180") ? rawEvent : (stryCov_9fa48("2180"), !rawEvent)) || (stryMutAct_9fa48("2182") ? typeof rawEvent === "object" : stryMutAct_9fa48("2181") ? false : (stryCov_9fa48("2181", "2182"), typeof rawEvent !== (stryMutAct_9fa48("2183") ? "" : (stryCov_9fa48("2183"), "object")))))) {
        if (stryMutAct_9fa48("2184")) {
          {}
        } else {
          stryCov_9fa48("2184");
          events.push(stryMutAct_9fa48("2185") ? {} : (stryCov_9fa48("2185"), {
            type: stryMutAct_9fa48("2186") ? "" : (stryCov_9fa48("2186"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2187") ? --this.sequence : (stryCov_9fa48("2187"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2188") ? "" : (stryCov_9fa48("2188"), "E_PROVIDER_EVENT_MALFORMED"),
            severity: stryMutAct_9fa48("2189") ? "" : (stryCov_9fa48("2189"), "error"),
            message: stryMutAct_9fa48("2190") ? "" : (stryCov_9fa48("2190"), "Raw event is not an object")
          }));
          return events;
        }
      }
      const chunk = rawEvent as {
        type?: string;
        index: number;
        content_block?: {
          type?: string;
          id: string;
          name: string;
        };
        delta?: {
          type?: string;
          partial_json: string;
          stop_reason: string;
        };
      };
      switch (chunk.type) {
        case stryMutAct_9fa48("2192") ? "" : (stryCov_9fa48("2192"), "content_block_start"):
          if (stryMutAct_9fa48("2191")) {} else {
            stryCov_9fa48("2191");
            {
              if (stryMutAct_9fa48("2193")) {
                {}
              } else {
                stryCov_9fa48("2193");
                if (stryMutAct_9fa48("2196") ? chunk.content_block?.type !== "tool_use" : stryMutAct_9fa48("2195") ? false : stryMutAct_9fa48("2194") ? true : (stryCov_9fa48("2194", "2195", "2196"), (stryMutAct_9fa48("2197") ? chunk.content_block.type : (stryCov_9fa48("2197"), chunk.content_block?.type)) === (stryMutAct_9fa48("2198") ? "" : (stryCov_9fa48("2198"), "tool_use")))) {
                  if (stryMutAct_9fa48("2199")) {
                    {}
                  } else {
                    stryCov_9fa48("2199");
                    const sourceKey = stryMutAct_9fa48("2200") ? `` : (stryCov_9fa48("2200"), `content-block:${chunk.index}`);
                    events.push(stryMutAct_9fa48("2201") ? {} : (stryCov_9fa48("2201"), {
                      type: stryMutAct_9fa48("2202") ? "" : (stryCov_9fa48("2202"), "tool_call_start"),
                      sequence: stryMutAct_9fa48("2203") ? --this.sequence : (stryCov_9fa48("2203"), ++this.sequence),
                      provider: this.provider,
                      callRef: stryMutAct_9fa48("2204") ? {} : (stryCov_9fa48("2204"), {
                        sourceKey
                      }),
                      toolIndex: chunk.index,
                      toolCallId: chunk.content_block.id,
                      name: chunk.content_block.name
                    }));
                  }
                }
                break;
              }
            }
          }
        case stryMutAct_9fa48("2206") ? "" : (stryCov_9fa48("2206"), "content_block_delta"):
          if (stryMutAct_9fa48("2205")) {} else {
            stryCov_9fa48("2205");
            {
              if (stryMutAct_9fa48("2207")) {
                {}
              } else {
                stryCov_9fa48("2207");
                if (stryMutAct_9fa48("2210") ? chunk.delta?.type === "input_json_delta" || typeof chunk.delta.partial_json === "string" : stryMutAct_9fa48("2209") ? false : stryMutAct_9fa48("2208") ? true : (stryCov_9fa48("2208", "2209", "2210"), (stryMutAct_9fa48("2212") ? chunk.delta?.type !== "input_json_delta" : stryMutAct_9fa48("2211") ? true : (stryCov_9fa48("2211", "2212"), (stryMutAct_9fa48("2213") ? chunk.delta.type : (stryCov_9fa48("2213"), chunk.delta?.type)) === (stryMutAct_9fa48("2214") ? "" : (stryCov_9fa48("2214"), "input_json_delta")))) && (stryMutAct_9fa48("2216") ? typeof chunk.delta.partial_json !== "string" : stryMutAct_9fa48("2215") ? true : (stryCov_9fa48("2215", "2216"), typeof chunk.delta.partial_json === (stryMutAct_9fa48("2217") ? "" : (stryCov_9fa48("2217"), "string")))))) {
                  if (stryMutAct_9fa48("2218")) {
                    {}
                  } else {
                    stryCov_9fa48("2218");
                    const sourceKey = stryMutAct_9fa48("2219") ? `` : (stryCov_9fa48("2219"), `content-block:${chunk.index}`);
                    events.push(stryMutAct_9fa48("2220") ? {} : (stryCov_9fa48("2220"), {
                      type: stryMutAct_9fa48("2221") ? "" : (stryCov_9fa48("2221"), "tool_call_arguments_delta"),
                      sequence: stryMutAct_9fa48("2222") ? --this.sequence : (stryCov_9fa48("2222"), ++this.sequence),
                      provider: this.provider,
                      callRef: stryMutAct_9fa48("2223") ? {} : (stryCov_9fa48("2223"), {
                        sourceKey
                      }),
                      delta: chunk.delta.partial_json
                    }));
                  }
                }
                break;
              }
            }
          }
        case stryMutAct_9fa48("2225") ? "" : (stryCov_9fa48("2225"), "content_block_stop"):
          if (stryMutAct_9fa48("2224")) {} else {
            stryCov_9fa48("2224");
            {
              if (stryMutAct_9fa48("2226")) {
                {}
              } else {
                stryCov_9fa48("2226");
                const sourceKey = stryMutAct_9fa48("2227") ? `` : (stryCov_9fa48("2227"), `content-block:${chunk.index}`);
                events.push(stryMutAct_9fa48("2228") ? {} : (stryCov_9fa48("2228"), {
                  type: stryMutAct_9fa48("2229") ? "" : (stryCov_9fa48("2229"), "tool_call_end"),
                  sequence: stryMutAct_9fa48("2230") ? --this.sequence : (stryCov_9fa48("2230"), ++this.sequence),
                  provider: this.provider,
                  callRef: stryMutAct_9fa48("2231") ? {} : (stryCov_9fa48("2231"), {
                    sourceKey
                  }),
                  reason: stryMutAct_9fa48("2232") ? "" : (stryCov_9fa48("2232"), "complete") // Default to complete, message_delta might adjust stream level
                }));
                break;
              }
            }
          }
        case stryMutAct_9fa48("2234") ? "" : (stryCov_9fa48("2234"), "message_delta"):
          if (stryMutAct_9fa48("2233")) {} else {
            stryCov_9fa48("2233");
            {
              if (stryMutAct_9fa48("2235")) {
                {}
              } else {
                stryCov_9fa48("2235");
                if (stryMutAct_9fa48("2238") ? chunk.delta.stop_reason : stryMutAct_9fa48("2237") ? false : stryMutAct_9fa48("2236") ? true : (stryCov_9fa48("2236", "2237", "2238"), chunk.delta?.stop_reason)) {
                  if (stryMutAct_9fa48("2239")) {
                    {}
                  } else {
                    stryCov_9fa48("2239");
                    const sr = chunk.delta.stop_reason;
                    let reason: StreamEndReason = stryMutAct_9fa48("2240") ? "" : (stryCov_9fa48("2240"), "unknown");
                    if (stryMutAct_9fa48("2243") ? sr === "end_turn" && sr === "tool_use" : stryMutAct_9fa48("2242") ? false : stryMutAct_9fa48("2241") ? true : (stryCov_9fa48("2241", "2242", "2243"), (stryMutAct_9fa48("2245") ? sr !== "end_turn" : stryMutAct_9fa48("2244") ? false : (stryCov_9fa48("2244", "2245"), sr === (stryMutAct_9fa48("2246") ? "" : (stryCov_9fa48("2246"), "end_turn")))) || (stryMutAct_9fa48("2248") ? sr !== "tool_use" : stryMutAct_9fa48("2247") ? false : (stryCov_9fa48("2247", "2248"), sr === (stryMutAct_9fa48("2249") ? "" : (stryCov_9fa48("2249"), "tool_use")))))) {
                      if (stryMutAct_9fa48("2250")) {
                        {}
                      } else {
                        stryCov_9fa48("2250");
                        reason = stryMutAct_9fa48("2251") ? "" : (stryCov_9fa48("2251"), "complete");
                      }
                    } else if (stryMutAct_9fa48("2254") ? sr !== "max_tokens" : stryMutAct_9fa48("2253") ? false : stryMutAct_9fa48("2252") ? true : (stryCov_9fa48("2252", "2253", "2254"), sr === (stryMutAct_9fa48("2255") ? "" : (stryCov_9fa48("2255"), "max_tokens")))) {
                      if (stryMutAct_9fa48("2256")) {
                        {}
                      } else {
                        stryCov_9fa48("2256");
                        reason = stryMutAct_9fa48("2257") ? "" : (stryCov_9fa48("2257"), "length");
                      }
                    }
                    events.push(stryMutAct_9fa48("2258") ? {} : (stryCov_9fa48("2258"), {
                      type: stryMutAct_9fa48("2259") ? "" : (stryCov_9fa48("2259"), "provider_stream_end"),
                      sequence: stryMutAct_9fa48("2260") ? --this.sequence : (stryCov_9fa48("2260"), ++this.sequence),
                      provider: this.provider,
                      reason,
                      providerReason: sr
                    }));
                    this.finished = stryMutAct_9fa48("2261") ? false : (stryCov_9fa48("2261"), true);
                  }
                }
                break;
              }
            }
          }
        case stryMutAct_9fa48("2263") ? "" : (stryCov_9fa48("2263"), "error"):
          if (stryMutAct_9fa48("2262")) {} else {
            stryCov_9fa48("2262");
            {
              if (stryMutAct_9fa48("2264")) {
                {}
              } else {
                stryCov_9fa48("2264");
                events.push(stryMutAct_9fa48("2265") ? {} : (stryCov_9fa48("2265"), {
                  type: stryMutAct_9fa48("2266") ? "" : (stryCov_9fa48("2266"), "provider_stream_end"),
                  sequence: stryMutAct_9fa48("2267") ? --this.sequence : (stryCov_9fa48("2267"), ++this.sequence),
                  provider: this.provider,
                  reason: stryMutAct_9fa48("2268") ? "" : (stryCov_9fa48("2268"), "provider_error"),
                  providerReason: stryMutAct_9fa48("2269") ? "" : (stryCov_9fa48("2269"), "error_event")
                }));
                this.finished = stryMutAct_9fa48("2270") ? false : (stryCov_9fa48("2270"), true);
                break;
              }
            }
          }
        // Unknown metadata events must not crash the adapter.
        default:
          if (stryMutAct_9fa48("2271")) {} else {
            stryCov_9fa48("2271");
            break;
          }
      }
      return events;
    }
  }
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2272")) {
      {}
    } else {
      stryCov_9fa48("2272");
      if (stryMutAct_9fa48("2274") ? false : stryMutAct_9fa48("2273") ? true : (stryCov_9fa48("2273", "2274"), this.finished)) return stryMutAct_9fa48("2275") ? ["Stryker was here"] : (stryCov_9fa48("2275"), []);
      this.finished = stryMutAct_9fa48("2276") ? false : (stryCov_9fa48("2276"), true);
      return stryMutAct_9fa48("2277") ? [] : (stryCov_9fa48("2277"), [stryMutAct_9fa48("2278") ? {} : (stryCov_9fa48("2278"), {
        type: stryMutAct_9fa48("2279") ? "" : (stryCov_9fa48("2279"), "provider_stream_end"),
        sequence: stryMutAct_9fa48("2280") ? --this.sequence : (stryCov_9fa48("2280"), ++this.sequence),
        provider: this.provider,
        reason: stryMutAct_9fa48("2281") ? meta?.reason && "unknown" : (stryCov_9fa48("2281"), (stryMutAct_9fa48("2282") ? meta.reason : (stryCov_9fa48("2282"), meta?.reason)) ?? (stryMutAct_9fa48("2283") ? "" : (stryCov_9fa48("2283"), "unknown"))),
        providerReason: stryMutAct_9fa48("2284") ? meta.providerReason : (stryCov_9fa48("2284"), meta?.providerReason)
      })]);
    }
  }
}