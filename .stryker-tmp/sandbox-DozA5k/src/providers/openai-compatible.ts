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
  delta?: OpenAIChoiceDelta;
  finish_reason?: string | null;
}
export interface OpenAICompatibleEvent {
  choices?: OpenAIChoice[];
}
export class OpenAICompatibleStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = stryMutAct_9fa48("2384") ? "" : (stryCov_9fa48("2384"), "openai-compatible");
  private sequence = 0;

  // Track known indices to emit start events correctly
  private knownIndices: Set<number> = new Set();
  // Keep track of sourceKeys to emit tool_call_end
  private knownSourceKeys: Set<string> = new Set();
  private finished = stryMutAct_9fa48("2385") ? true : (stryCov_9fa48("2385"), false);
  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2386")) {
      {}
    } else {
      stryCov_9fa48("2386");
      if (stryMutAct_9fa48("2388") ? false : stryMutAct_9fa48("2387") ? true : (stryCov_9fa48("2387", "2388"), this.finished)) {
        if (stryMutAct_9fa48("2389")) {
          {}
        } else {
          stryCov_9fa48("2389");
          return stryMutAct_9fa48("2390") ? [] : (stryCov_9fa48("2390"), [stryMutAct_9fa48("2391") ? {} : (stryCov_9fa48("2391"), {
            type: stryMutAct_9fa48("2392") ? "" : (stryCov_9fa48("2392"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2393") ? --this.sequence : (stryCov_9fa48("2393"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2394") ? "" : (stryCov_9fa48("2394"), "W_EVENT_AFTER_STREAM_END"),
            severity: stryMutAct_9fa48("2395") ? "" : (stryCov_9fa48("2395"), "warning"),
            message: stryMutAct_9fa48("2396") ? "" : (stryCov_9fa48("2396"), "Received event after stream finished")
          })]);
        }
      }
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2397") ? ["Stryker was here"] : (stryCov_9fa48("2397"), []);

      // Narrow unknown
      if (stryMutAct_9fa48("2400") ? !rawEvent && typeof rawEvent !== "object" : stryMutAct_9fa48("2399") ? false : stryMutAct_9fa48("2398") ? true : (stryCov_9fa48("2398", "2399", "2400"), (stryMutAct_9fa48("2401") ? rawEvent : (stryCov_9fa48("2401"), !rawEvent)) || (stryMutAct_9fa48("2403") ? typeof rawEvent === "object" : stryMutAct_9fa48("2402") ? false : (stryCov_9fa48("2402", "2403"), typeof rawEvent !== (stryMutAct_9fa48("2404") ? "" : (stryCov_9fa48("2404"), "object")))))) {
        if (stryMutAct_9fa48("2405")) {
          {}
        } else {
          stryCov_9fa48("2405");
          events.push(stryMutAct_9fa48("2406") ? {} : (stryCov_9fa48("2406"), {
            type: stryMutAct_9fa48("2407") ? "" : (stryCov_9fa48("2407"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2408") ? --this.sequence : (stryCov_9fa48("2408"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2409") ? "" : (stryCov_9fa48("2409"), "E_PROVIDER_EVENT_MALFORMED"),
            severity: stryMutAct_9fa48("2410") ? "" : (stryCov_9fa48("2410"), "error"),
            message: stryMutAct_9fa48("2411") ? "" : (stryCov_9fa48("2411"), "Raw event is not an object")
          }));
          return events;
        }
      }
      const chunk = rawEvent as OpenAICompatibleEvent;
      if (stryMutAct_9fa48("2413") ? false : stryMutAct_9fa48("2412") ? true : (stryCov_9fa48("2412", "2413"), Array.isArray(chunk.choices))) {
        if (stryMutAct_9fa48("2414")) {
          {}
        } else {
          stryCov_9fa48("2414");
          for (const choice of chunk.choices) {
            if (stryMutAct_9fa48("2415")) {
              {}
            } else {
              stryCov_9fa48("2415");
              if (stryMutAct_9fa48("2418") ? choice.delta || Array.isArray(choice.delta.tool_calls) : stryMutAct_9fa48("2417") ? false : stryMutAct_9fa48("2416") ? true : (stryCov_9fa48("2416", "2417", "2418"), choice.delta && Array.isArray(choice.delta.tool_calls))) {
                if (stryMutAct_9fa48("2419")) {
                  {}
                } else {
                  stryCov_9fa48("2419");
                  for (const tc of choice.delta.tool_calls) {
                    if (stryMutAct_9fa48("2420")) {
                      {}
                    } else {
                      stryCov_9fa48("2420");
                      if (stryMutAct_9fa48("2423") ? typeof tc.index === "number" : stryMutAct_9fa48("2422") ? false : stryMutAct_9fa48("2421") ? true : (stryCov_9fa48("2421", "2422", "2423"), typeof tc.index !== (stryMutAct_9fa48("2424") ? "" : (stryCov_9fa48("2424"), "number")))) {
                        if (stryMutAct_9fa48("2425")) {
                          {}
                        } else {
                          stryCov_9fa48("2425");
                          events.push(stryMutAct_9fa48("2426") ? {} : (stryCov_9fa48("2426"), {
                            type: stryMutAct_9fa48("2427") ? "" : (stryCov_9fa48("2427"), "provider_diagnostic"),
                            sequence: stryMutAct_9fa48("2428") ? --this.sequence : (stryCov_9fa48("2428"), ++this.sequence),
                            provider: this.provider,
                            code: stryMutAct_9fa48("2429") ? "" : (stryCov_9fa48("2429"), "E_PROVIDER_EVENT_MALFORMED"),
                            severity: stryMutAct_9fa48("2430") ? "" : (stryCov_9fa48("2430"), "error"),
                            message: stryMutAct_9fa48("2431") ? "" : (stryCov_9fa48("2431"), "tool_call index is missing or invalid")
                          }));
                          continue;
                        }
                      }
                      const sourceKey = stryMutAct_9fa48("2432") ? `` : (stryCov_9fa48("2432"), `choice:0/tool-index:${tc.index}`);
                      this.knownSourceKeys.add(sourceKey);
                      if (stryMutAct_9fa48("2435") ? false : stryMutAct_9fa48("2434") ? true : stryMutAct_9fa48("2433") ? this.knownIndices.has(tc.index) : (stryCov_9fa48("2433", "2434", "2435"), !this.knownIndices.has(tc.index))) {
                        if (stryMutAct_9fa48("2436")) {
                          {}
                        } else {
                          stryCov_9fa48("2436");
                          this.knownIndices.add(tc.index);
                          events.push(stryMutAct_9fa48("2437") ? {} : (stryCov_9fa48("2437"), {
                            type: stryMutAct_9fa48("2438") ? "" : (stryCov_9fa48("2438"), "tool_call_start"),
                            sequence: stryMutAct_9fa48("2439") ? --this.sequence : (stryCov_9fa48("2439"), ++this.sequence),
                            provider: this.provider,
                            callRef: stryMutAct_9fa48("2440") ? {} : (stryCov_9fa48("2440"), {
                              sourceKey
                            }),
                            toolIndex: tc.index,
                            toolCallId: tc.id,
                            name: stryMutAct_9fa48("2441") ? tc.function.name : (stryCov_9fa48("2441"), tc.function?.name)
                          }));
                        }
                      } else {
                        if (stryMutAct_9fa48("2442")) {
                          {}
                        } else {
                          stryCov_9fa48("2442");
                          // Send identity if ID provided late
                          if (stryMutAct_9fa48("2445") ? tc.id === undefined : stryMutAct_9fa48("2444") ? false : stryMutAct_9fa48("2443") ? true : (stryCov_9fa48("2443", "2444", "2445"), tc.id !== undefined)) {
                            if (stryMutAct_9fa48("2446")) {
                              {}
                            } else {
                              stryCov_9fa48("2446");
                              events.push(stryMutAct_9fa48("2447") ? {} : (stryCov_9fa48("2447"), {
                                type: stryMutAct_9fa48("2448") ? "" : (stryCov_9fa48("2448"), "tool_call_identity"),
                                sequence: stryMutAct_9fa48("2449") ? --this.sequence : (stryCov_9fa48("2449"), ++this.sequence),
                                provider: this.provider,
                                callRef: stryMutAct_9fa48("2450") ? {} : (stryCov_9fa48("2450"), {
                                  sourceKey
                                }),
                                toolCallId: tc.id,
                                toolIndex: tc.index
                              }));
                            }
                          }

                          // Name delta
                          if (stryMutAct_9fa48("2453") ? tc.function.name : stryMutAct_9fa48("2452") ? false : stryMutAct_9fa48("2451") ? true : (stryCov_9fa48("2451", "2452", "2453"), tc.function?.name)) {
                            if (stryMutAct_9fa48("2454")) {
                              {}
                            } else {
                              stryCov_9fa48("2454");
                              events.push(stryMutAct_9fa48("2455") ? {} : (stryCov_9fa48("2455"), {
                                type: stryMutAct_9fa48("2456") ? "" : (stryCov_9fa48("2456"), "tool_call_name_delta"),
                                sequence: stryMutAct_9fa48("2457") ? --this.sequence : (stryCov_9fa48("2457"), ++this.sequence),
                                provider: this.provider,
                                callRef: stryMutAct_9fa48("2458") ? {} : (stryCov_9fa48("2458"), {
                                  sourceKey
                                }),
                                delta: tc.function.name
                              }));
                            }
                          }
                        }
                      }

                      // Arguments delta
                      if (stryMutAct_9fa48("2461") ? tc.function.arguments : stryMutAct_9fa48("2460") ? false : stryMutAct_9fa48("2459") ? true : (stryCov_9fa48("2459", "2460", "2461"), tc.function?.arguments)) {
                        if (stryMutAct_9fa48("2462")) {
                          {}
                        } else {
                          stryCov_9fa48("2462");
                          events.push(stryMutAct_9fa48("2463") ? {} : (stryCov_9fa48("2463"), {
                            type: stryMutAct_9fa48("2464") ? "" : (stryCov_9fa48("2464"), "tool_call_arguments_delta"),
                            sequence: stryMutAct_9fa48("2465") ? --this.sequence : (stryCov_9fa48("2465"), ++this.sequence),
                            provider: this.provider,
                            callRef: stryMutAct_9fa48("2466") ? {} : (stryCov_9fa48("2466"), {
                              sourceKey
                            }),
                            delta: tc.function.arguments
                          }));
                        }
                      }
                    }
                  }
                }
              }
              if (stryMutAct_9fa48("2469") ? choice.finish_reason == null : stryMutAct_9fa48("2468") ? false : stryMutAct_9fa48("2467") ? true : (stryCov_9fa48("2467", "2468", "2469"), choice.finish_reason != null)) {
                if (stryMutAct_9fa48("2470")) {
                  {}
                } else {
                  stryCov_9fa48("2470");
                  // Stream ending, interpret reason
                  let reason: StreamEndReason = stryMutAct_9fa48("2471") ? "" : (stryCov_9fa48("2471"), "unknown");
                  if (stryMutAct_9fa48("2474") ? choice.finish_reason === "stop" && choice.finish_reason === "tool_calls" : stryMutAct_9fa48("2473") ? false : stryMutAct_9fa48("2472") ? true : (stryCov_9fa48("2472", "2473", "2474"), (stryMutAct_9fa48("2476") ? choice.finish_reason !== "stop" : stryMutAct_9fa48("2475") ? false : (stryCov_9fa48("2475", "2476"), choice.finish_reason === (stryMutAct_9fa48("2477") ? "" : (stryCov_9fa48("2477"), "stop")))) || (stryMutAct_9fa48("2479") ? choice.finish_reason !== "tool_calls" : stryMutAct_9fa48("2478") ? false : (stryCov_9fa48("2478", "2479"), choice.finish_reason === (stryMutAct_9fa48("2480") ? "" : (stryCov_9fa48("2480"), "tool_calls")))))) {
                    if (stryMutAct_9fa48("2481")) {
                      {}
                    } else {
                      stryCov_9fa48("2481");
                      reason = stryMutAct_9fa48("2482") ? "" : (stryCov_9fa48("2482"), "complete");
                    }
                  } else if (stryMutAct_9fa48("2485") ? choice.finish_reason !== "length" : stryMutAct_9fa48("2484") ? false : stryMutAct_9fa48("2483") ? true : (stryCov_9fa48("2483", "2484", "2485"), choice.finish_reason === (stryMutAct_9fa48("2486") ? "" : (stryCov_9fa48("2486"), "length")))) {
                    if (stryMutAct_9fa48("2487")) {
                      {}
                    } else {
                      stryCov_9fa48("2487");
                      reason = stryMutAct_9fa48("2488") ? "" : (stryCov_9fa48("2488"), "length");
                    }
                  } else if (stryMutAct_9fa48("2491") ? choice.finish_reason !== "cancelled" : stryMutAct_9fa48("2490") ? false : stryMutAct_9fa48("2489") ? true : (stryCov_9fa48("2489", "2490", "2491"), choice.finish_reason === (stryMutAct_9fa48("2492") ? "" : (stryCov_9fa48("2492"), "cancelled")))) {
                    if (stryMutAct_9fa48("2493")) {
                      {}
                    } else {
                      stryCov_9fa48("2493");
                      reason = stryMutAct_9fa48("2494") ? "" : (stryCov_9fa48("2494"), "cancelled");
                    }
                  }
                  for (const sourceKey of this.knownSourceKeys.values()) {
                    if (stryMutAct_9fa48("2495")) {
                      {}
                    } else {
                      stryCov_9fa48("2495");
                      events.push(stryMutAct_9fa48("2496") ? {} : (stryCov_9fa48("2496"), {
                        type: stryMutAct_9fa48("2497") ? "" : (stryCov_9fa48("2497"), "tool_call_end"),
                        sequence: stryMutAct_9fa48("2498") ? --this.sequence : (stryCov_9fa48("2498"), ++this.sequence),
                        provider: this.provider,
                        callRef: stryMutAct_9fa48("2499") ? {} : (stryCov_9fa48("2499"), {
                          sourceKey
                        }),
                        reason: reason,
                        providerReason: choice.finish_reason
                      }));
                    }
                  }
                  this.knownSourceKeys.clear();
                  events.push(stryMutAct_9fa48("2500") ? {} : (stryCov_9fa48("2500"), {
                    type: stryMutAct_9fa48("2501") ? "" : (stryCov_9fa48("2501"), "provider_stream_end"),
                    sequence: stryMutAct_9fa48("2502") ? --this.sequence : (stryCov_9fa48("2502"), ++this.sequence),
                    provider: this.provider,
                    reason,
                    providerReason: choice.finish_reason
                  }));
                  this.finished = stryMutAct_9fa48("2503") ? false : (stryCov_9fa48("2503"), true);
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
    if (stryMutAct_9fa48("2504")) {
      {}
    } else {
      stryCov_9fa48("2504");
      if (stryMutAct_9fa48("2506") ? false : stryMutAct_9fa48("2505") ? true : (stryCov_9fa48("2505", "2506"), this.finished)) return stryMutAct_9fa48("2507") ? ["Stryker was here"] : (stryCov_9fa48("2507"), []);
      this.finished = stryMutAct_9fa48("2508") ? false : (stryCov_9fa48("2508"), true);
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2509") ? ["Stryker was here"] : (stryCov_9fa48("2509"), []);
      for (const sourceKey of this.knownSourceKeys.values()) {
        if (stryMutAct_9fa48("2510")) {
          {}
        } else {
          stryCov_9fa48("2510");
          events.push(stryMutAct_9fa48("2511") ? {} : (stryCov_9fa48("2511"), {
            type: stryMutAct_9fa48("2512") ? "" : (stryCov_9fa48("2512"), "tool_call_end"),
            sequence: stryMutAct_9fa48("2513") ? --this.sequence : (stryCov_9fa48("2513"), ++this.sequence),
            provider: this.provider,
            callRef: stryMutAct_9fa48("2514") ? {} : (stryCov_9fa48("2514"), {
              sourceKey
            }),
            reason: stryMutAct_9fa48("2515") ? meta?.reason && "unknown" : (stryCov_9fa48("2515"), (stryMutAct_9fa48("2516") ? meta.reason : (stryCov_9fa48("2516"), meta?.reason)) ?? (stryMutAct_9fa48("2517") ? "" : (stryCov_9fa48("2517"), "unknown"))),
            providerReason: stryMutAct_9fa48("2518") ? meta.providerReason : (stryCov_9fa48("2518"), meta?.providerReason)
          }));
        }
      }
      this.knownSourceKeys.clear();
      events.push(stryMutAct_9fa48("2519") ? {} : (stryCov_9fa48("2519"), {
        type: stryMutAct_9fa48("2520") ? "" : (stryCov_9fa48("2520"), "provider_stream_end"),
        sequence: stryMutAct_9fa48("2521") ? --this.sequence : (stryCov_9fa48("2521"), ++this.sequence),
        provider: this.provider,
        reason: stryMutAct_9fa48("2522") ? meta?.reason && "unknown" : (stryCov_9fa48("2522"), (stryMutAct_9fa48("2523") ? meta.reason : (stryCov_9fa48("2523"), meta?.reason)) ?? (stryMutAct_9fa48("2524") ? "" : (stryCov_9fa48("2524"), "unknown"))),
        providerReason: stryMutAct_9fa48("2525") ? meta.providerReason : (stryCov_9fa48("2525"), meta?.providerReason)
      }));
      return events;
    }
  }
}