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

// Gemini function call shape (structured)
interface GeminiFunctionCall {
  name?: string;
  args?: Record<string, unknown>; // Note: Gemini typically returns structured objects, not raw JSON strings
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
  readonly provider: ProviderName = stryMutAct_9fa48("2285") ? "" : (stryCov_9fa48("2285"), "gemini");
  private sequence = 0;
  private finished = stryMutAct_9fa48("2286") ? true : (stryCov_9fa48("2286"), false);
  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2287")) {
      {}
    } else {
      stryCov_9fa48("2287");
      if (stryMutAct_9fa48("2289") ? false : stryMutAct_9fa48("2288") ? true : (stryCov_9fa48("2288", "2289"), this.finished)) return stryMutAct_9fa48("2290") ? ["Stryker was here"] : (stryCov_9fa48("2290"), []);
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2291") ? ["Stryker was here"] : (stryCov_9fa48("2291"), []);
      if (stryMutAct_9fa48("2294") ? !rawEvent && typeof rawEvent !== "object" : stryMutAct_9fa48("2293") ? false : stryMutAct_9fa48("2292") ? true : (stryCov_9fa48("2292", "2293", "2294"), (stryMutAct_9fa48("2295") ? rawEvent : (stryCov_9fa48("2295"), !rawEvent)) || (stryMutAct_9fa48("2297") ? typeof rawEvent === "object" : stryMutAct_9fa48("2296") ? false : (stryCov_9fa48("2296", "2297"), typeof rawEvent !== (stryMutAct_9fa48("2298") ? "" : (stryCov_9fa48("2298"), "object")))))) {
        if (stryMutAct_9fa48("2299")) {
          {}
        } else {
          stryCov_9fa48("2299");
          events.push(stryMutAct_9fa48("2300") ? {} : (stryCov_9fa48("2300"), {
            type: stryMutAct_9fa48("2301") ? "" : (stryCov_9fa48("2301"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2302") ? --this.sequence : (stryCov_9fa48("2302"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2303") ? "" : (stryCov_9fa48("2303"), "E_PROVIDER_EVENT_MALFORMED"),
            severity: stryMutAct_9fa48("2304") ? "" : (stryCov_9fa48("2304"), "error"),
            message: stryMutAct_9fa48("2305") ? "" : (stryCov_9fa48("2305"), "Raw event is not an object")
          }));
          return events;
        }
      }
      const chunk = rawEvent as GeminiEvent;
      if (stryMutAct_9fa48("2307") ? false : stryMutAct_9fa48("2306") ? true : (stryCov_9fa48("2306", "2307"), Array.isArray(chunk.candidates))) {
        if (stryMutAct_9fa48("2308")) {
          {}
        } else {
          stryCov_9fa48("2308");
          for (const [candidateIndex, candidate] of chunk.candidates.entries()) {
            if (stryMutAct_9fa48("2309")) {
              {}
            } else {
              stryCov_9fa48("2309");
              if (stryMutAct_9fa48("2312") ? candidate.content || Array.isArray(candidate.content.parts) : stryMutAct_9fa48("2311") ? false : stryMutAct_9fa48("2310") ? true : (stryCov_9fa48("2310", "2311", "2312"), candidate.content && Array.isArray(candidate.content.parts))) {
                if (stryMutAct_9fa48("2313")) {
                  {}
                } else {
                  stryCov_9fa48("2313");
                  for (const [partIndex, part] of candidate.content.parts.entries()) {
                    if (stryMutAct_9fa48("2314")) {
                      {}
                    } else {
                      stryCov_9fa48("2314");
                      if (stryMutAct_9fa48("2316") ? false : stryMutAct_9fa48("2315") ? true : (stryCov_9fa48("2315", "2316"), part.functionCall)) {
                        if (stryMutAct_9fa48("2317")) {
                          {}
                        } else {
                          stryCov_9fa48("2317");
                          const fc = part.functionCall;
                          const sourceKey = stryMutAct_9fa48("2318") ? `` : (stryCov_9fa48("2318"), `candidate:${candidateIndex}/part:${partIndex}`);
                          events.push(stryMutAct_9fa48("2319") ? {} : (stryCov_9fa48("2319"), {
                            type: stryMutAct_9fa48("2320") ? "" : (stryCov_9fa48("2320"), "tool_call_start"),
                            sequence: stryMutAct_9fa48("2321") ? --this.sequence : (stryCov_9fa48("2321"), ++this.sequence),
                            provider: this.provider,
                            callRef: stryMutAct_9fa48("2322") ? {} : (stryCov_9fa48("2322"), {
                              sourceKey
                            }),
                            name: fc.name
                          }));
                          if (stryMutAct_9fa48("2324") ? false : stryMutAct_9fa48("2323") ? true : (stryCov_9fa48("2323", "2324"), fc.args)) {
                            if (stryMutAct_9fa48("2325")) {
                              {}
                            } else {
                              stryCov_9fa48("2325");
                              // Gemini currently emits structured objects.
                              // We serialize it to emulate a text delta, BUT it is documented in docs/providers/gemini.md 
                              // that this is NOT byte-level streaming. It is object-level final delivery.
                              events.push(stryMutAct_9fa48("2326") ? {} : (stryCov_9fa48("2326"), {
                                type: stryMutAct_9fa48("2327") ? "" : (stryCov_9fa48("2327"), "tool_call_arguments_delta"),
                                sequence: stryMutAct_9fa48("2328") ? --this.sequence : (stryCov_9fa48("2328"), ++this.sequence),
                                provider: this.provider,
                                callRef: stryMutAct_9fa48("2329") ? {} : (stryCov_9fa48("2329"), {
                                  sourceKey
                                }),
                                delta: JSON.stringify(fc.args)
                              }));
                            }
                          }
                          events.push(stryMutAct_9fa48("2330") ? {} : (stryCov_9fa48("2330"), {
                            type: stryMutAct_9fa48("2331") ? "" : (stryCov_9fa48("2331"), "tool_call_end"),
                            sequence: stryMutAct_9fa48("2332") ? --this.sequence : (stryCov_9fa48("2332"), ++this.sequence),
                            provider: this.provider,
                            callRef: stryMutAct_9fa48("2333") ? {} : (stryCov_9fa48("2333"), {
                              sourceKey
                            }),
                            reason: stryMutAct_9fa48("2334") ? "" : (stryCov_9fa48("2334"), "complete")
                          }));
                        }
                      }
                    }
                  }
                }
              }
              if (stryMutAct_9fa48("2336") ? false : stryMutAct_9fa48("2335") ? true : (stryCov_9fa48("2335", "2336"), candidate.finishReason)) {
                if (stryMutAct_9fa48("2337")) {
                  {}
                } else {
                  stryCov_9fa48("2337");
                  let reason: StreamEndReason = stryMutAct_9fa48("2338") ? "" : (stryCov_9fa48("2338"), "unknown");
                  if (stryMutAct_9fa48("2341") ? candidate.finishReason !== "STOP" : stryMutAct_9fa48("2340") ? false : stryMutAct_9fa48("2339") ? true : (stryCov_9fa48("2339", "2340", "2341"), candidate.finishReason === (stryMutAct_9fa48("2342") ? "" : (stryCov_9fa48("2342"), "STOP")))) {
                    if (stryMutAct_9fa48("2343")) {
                      {}
                    } else {
                      stryCov_9fa48("2343");
                      reason = stryMutAct_9fa48("2344") ? "" : (stryCov_9fa48("2344"), "complete");
                    }
                  } else if (stryMutAct_9fa48("2347") ? candidate.finishReason !== "MAX_TOKENS" : stryMutAct_9fa48("2346") ? false : stryMutAct_9fa48("2345") ? true : (stryCov_9fa48("2345", "2346", "2347"), candidate.finishReason === (stryMutAct_9fa48("2348") ? "" : (stryCov_9fa48("2348"), "MAX_TOKENS")))) {
                    if (stryMutAct_9fa48("2349")) {
                      {}
                    } else {
                      stryCov_9fa48("2349");
                      reason = stryMutAct_9fa48("2350") ? "" : (stryCov_9fa48("2350"), "length");
                    }
                  } else if (stryMutAct_9fa48("2353") ? (candidate.finishReason === "SAFETY" || candidate.finishReason === "RECITATION") && candidate.finishReason === "OTHER" : stryMutAct_9fa48("2352") ? false : stryMutAct_9fa48("2351") ? true : (stryCov_9fa48("2351", "2352", "2353"), (stryMutAct_9fa48("2355") ? candidate.finishReason === "SAFETY" && candidate.finishReason === "RECITATION" : stryMutAct_9fa48("2354") ? false : (stryCov_9fa48("2354", "2355"), (stryMutAct_9fa48("2357") ? candidate.finishReason !== "SAFETY" : stryMutAct_9fa48("2356") ? false : (stryCov_9fa48("2356", "2357"), candidate.finishReason === (stryMutAct_9fa48("2358") ? "" : (stryCov_9fa48("2358"), "SAFETY")))) || (stryMutAct_9fa48("2360") ? candidate.finishReason !== "RECITATION" : stryMutAct_9fa48("2359") ? false : (stryCov_9fa48("2359", "2360"), candidate.finishReason === (stryMutAct_9fa48("2361") ? "" : (stryCov_9fa48("2361"), "RECITATION")))))) || (stryMutAct_9fa48("2363") ? candidate.finishReason !== "OTHER" : stryMutAct_9fa48("2362") ? false : (stryCov_9fa48("2362", "2363"), candidate.finishReason === (stryMutAct_9fa48("2364") ? "" : (stryCov_9fa48("2364"), "OTHER")))))) {
                    if (stryMutAct_9fa48("2365")) {
                      {}
                    } else {
                      stryCov_9fa48("2365");
                      reason = stryMutAct_9fa48("2366") ? "" : (stryCov_9fa48("2366"), "cancelled");
                    }
                  }
                  events.push(stryMutAct_9fa48("2367") ? {} : (stryCov_9fa48("2367"), {
                    type: stryMutAct_9fa48("2368") ? "" : (stryCov_9fa48("2368"), "provider_stream_end"),
                    sequence: stryMutAct_9fa48("2369") ? --this.sequence : (stryCov_9fa48("2369"), ++this.sequence),
                    provider: this.provider,
                    reason,
                    providerReason: candidate.finishReason
                  }));
                  this.finished = stryMutAct_9fa48("2370") ? false : (stryCov_9fa48("2370"), true);
                }
              }
            }
          }
        }
      }
      return events;
    }
  }
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2371")) {
      {}
    } else {
      stryCov_9fa48("2371");
      if (stryMutAct_9fa48("2373") ? false : stryMutAct_9fa48("2372") ? true : (stryCov_9fa48("2372", "2373"), this.finished)) return stryMutAct_9fa48("2374") ? ["Stryker was here"] : (stryCov_9fa48("2374"), []);
      this.finished = stryMutAct_9fa48("2375") ? false : (stryCov_9fa48("2375"), true);
      return stryMutAct_9fa48("2376") ? [] : (stryCov_9fa48("2376"), [stryMutAct_9fa48("2377") ? {} : (stryCov_9fa48("2377"), {
        type: stryMutAct_9fa48("2378") ? "" : (stryCov_9fa48("2378"), "provider_stream_end"),
        sequence: stryMutAct_9fa48("2379") ? --this.sequence : (stryCov_9fa48("2379"), ++this.sequence),
        provider: this.provider,
        reason: stryMutAct_9fa48("2380") ? meta?.reason && "unknown" : (stryCov_9fa48("2380"), (stryMutAct_9fa48("2381") ? meta.reason : (stryCov_9fa48("2381"), meta?.reason)) ?? (stryMutAct_9fa48("2382") ? "" : (stryCov_9fa48("2382"), "unknown"))),
        providerReason: stryMutAct_9fa48("2383") ? meta.providerReason : (stryCov_9fa48("2383"), meta?.providerReason)
      })]);
    }
  }
}