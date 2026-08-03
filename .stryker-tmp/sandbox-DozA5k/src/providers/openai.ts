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
interface OpenAIFunctionCallDelta {
  name?: string;
  arguments?: string;
}
interface OpenAIChoice {
  delta?: {
    function_call?: OpenAIFunctionCallDelta;
    tool_calls?: unknown;
  };
  finish_reason?: string | null;
}
export interface OpenAIEvent {
  choices?: OpenAIChoice[];
  type?: string;
  output_index?: number;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  item_id?: string;
  delta?: string;
  arguments?: string;
  response?: {
    status?: string;
  };
}
export class OpenAIStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = stryMutAct_9fa48("2526") ? "" : (stryCov_9fa48("2526"), "openai");
  private sequence = 0;

  // Delegating tool_calls format to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();

  // For function_call (legacy)
  private hasLegacyFunctionCall = stryMutAct_9fa48("2527") ? true : (stryCov_9fa48("2527"), false);
  private legacySourceKey = stryMutAct_9fa48("2528") ? "" : (stryCov_9fa48("2528"), "legacy-function-call");

  // For Responses API
  private accumulatedArguments = new Map<string, string>();
  private receivedDeltas = new Set<string>();
  private finished = stryMutAct_9fa48("2529") ? true : (stryCov_9fa48("2529"), false);
  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (stryMutAct_9fa48("2530")) {
      {}
    } else {
      stryCov_9fa48("2530");
      if (stryMutAct_9fa48("2532") ? false : stryMutAct_9fa48("2531") ? true : (stryCov_9fa48("2531", "2532"), this.finished)) return stryMutAct_9fa48("2533") ? ["Stryker was here"] : (stryCov_9fa48("2533"), []);
      const events: NormalizedToolStreamEvent[] = stryMutAct_9fa48("2534") ? ["Stryker was here"] : (stryCov_9fa48("2534"), []);
      if (stryMutAct_9fa48("2537") ? !rawEvent && typeof rawEvent !== "object" : stryMutAct_9fa48("2536") ? false : stryMutAct_9fa48("2535") ? true : (stryCov_9fa48("2535", "2536", "2537"), (stryMutAct_9fa48("2538") ? rawEvent : (stryCov_9fa48("2538"), !rawEvent)) || (stryMutAct_9fa48("2540") ? typeof rawEvent === "object" : stryMutAct_9fa48("2539") ? false : (stryCov_9fa48("2539", "2540"), typeof rawEvent !== (stryMutAct_9fa48("2541") ? "" : (stryCov_9fa48("2541"), "object")))))) {
        if (stryMutAct_9fa48("2542")) {
          {}
        } else {
          stryCov_9fa48("2542");
          events.push(stryMutAct_9fa48("2543") ? {} : (stryCov_9fa48("2543"), {
            type: stryMutAct_9fa48("2544") ? "" : (stryCov_9fa48("2544"), "provider_diagnostic"),
            sequence: stryMutAct_9fa48("2545") ? --this.sequence : (stryCov_9fa48("2545"), ++this.sequence),
            provider: this.provider,
            code: stryMutAct_9fa48("2546") ? "" : (stryCov_9fa48("2546"), "E_PROVIDER_EVENT_MALFORMED"),
            severity: stryMutAct_9fa48("2547") ? "" : (stryCov_9fa48("2547"), "error"),
            message: stryMutAct_9fa48("2548") ? "" : (stryCov_9fa48("2548"), "Raw event is not an object")
          }));
          return events;
        }
      }
      const chunk = rawEvent as OpenAIEvent;

      // Handle Responses API
      if (stryMutAct_9fa48("2551") ? chunk.type?.startsWith("response.") && chunk.type === "error" : stryMutAct_9fa48("2550") ? false : stryMutAct_9fa48("2549") ? true : (stryCov_9fa48("2549", "2550", "2551"), (stryMutAct_9fa48("2553") ? chunk.type.startsWith("response.") : stryMutAct_9fa48("2552") ? chunk.type?.endsWith("response.") : (stryCov_9fa48("2552", "2553"), chunk.type?.startsWith(stryMutAct_9fa48("2554") ? "" : (stryCov_9fa48("2554"), "response.")))) || (stryMutAct_9fa48("2556") ? chunk.type !== "error" : stryMutAct_9fa48("2555") ? false : (stryCov_9fa48("2555", "2556"), chunk.type === (stryMutAct_9fa48("2557") ? "" : (stryCov_9fa48("2557"), "error")))))) {
        if (stryMutAct_9fa48("2558")) {
          {}
        } else {
          stryCov_9fa48("2558");
          if (stryMutAct_9fa48("2561") ? chunk.type !== "error" : stryMutAct_9fa48("2560") ? false : stryMutAct_9fa48("2559") ? true : (stryCov_9fa48("2559", "2560", "2561"), chunk.type === (stryMutAct_9fa48("2562") ? "" : (stryCov_9fa48("2562"), "error")))) {
            if (stryMutAct_9fa48("2563")) {
              {}
            } else {
              stryCov_9fa48("2563");
              events.push(stryMutAct_9fa48("2564") ? {} : (stryCov_9fa48("2564"), {
                type: stryMutAct_9fa48("2565") ? "" : (stryCov_9fa48("2565"), "provider_stream_end"),
                sequence: stryMutAct_9fa48("2566") ? --this.sequence : (stryCov_9fa48("2566"), ++this.sequence),
                provider: this.provider,
                reason: stryMutAct_9fa48("2567") ? "" : (stryCov_9fa48("2567"), "provider_error"),
                providerReason: stryMutAct_9fa48("2568") ? "" : (stryCov_9fa48("2568"), "error")
              }));
              this.finished = stryMutAct_9fa48("2569") ? false : (stryCov_9fa48("2569"), true);
              return events;
            }
          }
          if (stryMutAct_9fa48("2572") ? chunk.type === "response.output_item.added" && chunk.item?.type === "function_call" || chunk.item.id : stryMutAct_9fa48("2571") ? false : stryMutAct_9fa48("2570") ? true : (stryCov_9fa48("2570", "2571", "2572"), (stryMutAct_9fa48("2574") ? chunk.type === "response.output_item.added" || chunk.item?.type === "function_call" : stryMutAct_9fa48("2573") ? true : (stryCov_9fa48("2573", "2574"), (stryMutAct_9fa48("2576") ? chunk.type !== "response.output_item.added" : stryMutAct_9fa48("2575") ? true : (stryCov_9fa48("2575", "2576"), chunk.type === (stryMutAct_9fa48("2577") ? "" : (stryCov_9fa48("2577"), "response.output_item.added")))) && (stryMutAct_9fa48("2579") ? chunk.item?.type !== "function_call" : stryMutAct_9fa48("2578") ? true : (stryCov_9fa48("2578", "2579"), (stryMutAct_9fa48("2580") ? chunk.item.type : (stryCov_9fa48("2580"), chunk.item?.type)) === (stryMutAct_9fa48("2581") ? "" : (stryCov_9fa48("2581"), "function_call")))))) && chunk.item.id)) {
            if (stryMutAct_9fa48("2582")) {
              {}
            } else {
              stryCov_9fa48("2582");
              events.push(stryMutAct_9fa48("2583") ? {} : (stryCov_9fa48("2583"), {
                type: stryMutAct_9fa48("2584") ? "" : (stryCov_9fa48("2584"), "tool_call_start"),
                sequence: stryMutAct_9fa48("2585") ? --this.sequence : (stryCov_9fa48("2585"), ++this.sequence),
                provider: this.provider,
                callRef: stryMutAct_9fa48("2586") ? {} : (stryCov_9fa48("2586"), {
                  sourceKey: stryMutAct_9fa48("2587") ? `` : (stryCov_9fa48("2587"), `output-item:${chunk.item.id}`)
                }),
                toolCallId: chunk.item.call_id,
                name: chunk.item.name
              }));
            }
          } else if (stryMutAct_9fa48("2590") ? chunk.type === "response.function_call_arguments.delta" && chunk.item_id || chunk.delta : stryMutAct_9fa48("2589") ? false : stryMutAct_9fa48("2588") ? true : (stryCov_9fa48("2588", "2589", "2590"), (stryMutAct_9fa48("2592") ? chunk.type === "response.function_call_arguments.delta" || chunk.item_id : stryMutAct_9fa48("2591") ? true : (stryCov_9fa48("2591", "2592"), (stryMutAct_9fa48("2594") ? chunk.type !== "response.function_call_arguments.delta" : stryMutAct_9fa48("2593") ? true : (stryCov_9fa48("2593", "2594"), chunk.type === (stryMutAct_9fa48("2595") ? "" : (stryCov_9fa48("2595"), "response.function_call_arguments.delta")))) && chunk.item_id)) && chunk.delta)) {
            if (stryMutAct_9fa48("2596")) {
              {}
            } else {
              stryCov_9fa48("2596");
              this.receivedDeltas.add(chunk.item_id);
              const acc = stryMutAct_9fa48("2597") ? this.accumulatedArguments.get(chunk.item_id) && "" : (stryCov_9fa48("2597"), this.accumulatedArguments.get(chunk.item_id) ?? (stryMutAct_9fa48("2598") ? "Stryker was here!" : (stryCov_9fa48("2598"), "")));
              this.accumulatedArguments.set(chunk.item_id, stryMutAct_9fa48("2599") ? acc - chunk.delta : (stryCov_9fa48("2599"), acc + chunk.delta));
              events.push(stryMutAct_9fa48("2600") ? {} : (stryCov_9fa48("2600"), {
                type: stryMutAct_9fa48("2601") ? "" : (stryCov_9fa48("2601"), "tool_call_arguments_delta"),
                sequence: stryMutAct_9fa48("2602") ? --this.sequence : (stryCov_9fa48("2602"), ++this.sequence),
                provider: this.provider,
                callRef: stryMutAct_9fa48("2603") ? {} : (stryCov_9fa48("2603"), {
                  sourceKey: stryMutAct_9fa48("2604") ? `` : (stryCov_9fa48("2604"), `output-item:${chunk.item_id}`)
                }),
                delta: chunk.delta
              }));
            }
          } else if (stryMutAct_9fa48("2607") ? chunk.type === "response.function_call_arguments.done" && chunk.item_id || chunk.arguments !== undefined : stryMutAct_9fa48("2606") ? false : stryMutAct_9fa48("2605") ? true : (stryCov_9fa48("2605", "2606", "2607"), (stryMutAct_9fa48("2609") ? chunk.type === "response.function_call_arguments.done" || chunk.item_id : stryMutAct_9fa48("2608") ? true : (stryCov_9fa48("2608", "2609"), (stryMutAct_9fa48("2611") ? chunk.type !== "response.function_call_arguments.done" : stryMutAct_9fa48("2610") ? true : (stryCov_9fa48("2610", "2611"), chunk.type === (stryMutAct_9fa48("2612") ? "" : (stryCov_9fa48("2612"), "response.function_call_arguments.done")))) && chunk.item_id)) && (stryMutAct_9fa48("2614") ? chunk.arguments === undefined : stryMutAct_9fa48("2613") ? true : (stryCov_9fa48("2613", "2614"), chunk.arguments !== undefined)))) {
            if (stryMutAct_9fa48("2615")) {
              {}
            } else {
              stryCov_9fa48("2615");
              const acc = stryMutAct_9fa48("2616") ? this.accumulatedArguments.get(chunk.item_id) && "" : (stryCov_9fa48("2616"), this.accumulatedArguments.get(chunk.item_id) ?? (stryMutAct_9fa48("2617") ? "Stryker was here!" : (stryCov_9fa48("2617"), "")));
              const hasDeltas = this.receivedDeltas.has(chunk.item_id);
              if (stryMutAct_9fa48("2620") ? !hasDeltas || chunk.arguments.length > 0 : stryMutAct_9fa48("2619") ? false : stryMutAct_9fa48("2618") ? true : (stryCov_9fa48("2618", "2619", "2620"), (stryMutAct_9fa48("2621") ? hasDeltas : (stryCov_9fa48("2621"), !hasDeltas)) && (stryMutAct_9fa48("2624") ? chunk.arguments.length <= 0 : stryMutAct_9fa48("2623") ? chunk.arguments.length >= 0 : stryMutAct_9fa48("2622") ? true : (stryCov_9fa48("2622", "2623", "2624"), chunk.arguments.length > 0)))) {
                if (stryMutAct_9fa48("2625")) {
                  {}
                } else {
                  stryCov_9fa48("2625");
                  // No deltas, just final arguments.
                  events.push(stryMutAct_9fa48("2626") ? {} : (stryCov_9fa48("2626"), {
                    type: stryMutAct_9fa48("2627") ? "" : (stryCov_9fa48("2627"), "tool_call_arguments_delta"),
                    sequence: stryMutAct_9fa48("2628") ? --this.sequence : (stryCov_9fa48("2628"), ++this.sequence),
                    provider: this.provider,
                    callRef: stryMutAct_9fa48("2629") ? {} : (stryCov_9fa48("2629"), {
                      sourceKey: stryMutAct_9fa48("2630") ? `` : (stryCov_9fa48("2630"), `output-item:${chunk.item_id}`)
                    }),
                    delta: chunk.arguments
                  }));
                  this.accumulatedArguments.set(chunk.item_id, chunk.arguments);
                }
              } else if (stryMutAct_9fa48("2633") ? hasDeltas || chunk.arguments !== acc : stryMutAct_9fa48("2632") ? false : stryMutAct_9fa48("2631") ? true : (stryCov_9fa48("2631", "2632", "2633"), hasDeltas && (stryMutAct_9fa48("2635") ? chunk.arguments === acc : stryMutAct_9fa48("2634") ? true : (stryCov_9fa48("2634", "2635"), chunk.arguments !== acc)))) {
                if (stryMutAct_9fa48("2636")) {
                  {}
                } else {
                  stryCov_9fa48("2636");
                  events.push(stryMutAct_9fa48("2637") ? {} : (stryCov_9fa48("2637"), {
                    type: stryMutAct_9fa48("2638") ? "" : (stryCov_9fa48("2638"), "provider_diagnostic"),
                    sequence: stryMutAct_9fa48("2639") ? --this.sequence : (stryCov_9fa48("2639"), ++this.sequence),
                    provider: this.provider,
                    callRef: stryMutAct_9fa48("2640") ? {} : (stryCov_9fa48("2640"), {
                      sourceKey: stryMutAct_9fa48("2641") ? `` : (stryCov_9fa48("2641"), `output-item:${chunk.item_id}`)
                    }),
                    code: stryMutAct_9fa48("2642") ? "" : (stryCov_9fa48("2642"), "E_FINAL_ARGUMENTS_CONFLICT"),
                    severity: stryMutAct_9fa48("2643") ? "" : (stryCov_9fa48("2643"), "error"),
                    message: stryMutAct_9fa48("2644") ? "" : (stryCov_9fa48("2644"), "Final arguments do not match accumulated deltas")
                  }));
                }
              }
            }
          } else if (stryMutAct_9fa48("2647") ? chunk.type === "response.output_item.done" || chunk.item?.id : stryMutAct_9fa48("2646") ? false : stryMutAct_9fa48("2645") ? true : (stryCov_9fa48("2645", "2646", "2647"), (stryMutAct_9fa48("2649") ? chunk.type !== "response.output_item.done" : stryMutAct_9fa48("2648") ? true : (stryCov_9fa48("2648", "2649"), chunk.type === (stryMutAct_9fa48("2650") ? "" : (stryCov_9fa48("2650"), "response.output_item.done")))) && (stryMutAct_9fa48("2651") ? chunk.item.id : (stryCov_9fa48("2651"), chunk.item?.id)))) {
            if (stryMutAct_9fa48("2652")) {
              {}
            } else {
              stryCov_9fa48("2652");
              events.push(stryMutAct_9fa48("2653") ? {} : (stryCov_9fa48("2653"), {
                type: stryMutAct_9fa48("2654") ? "" : (stryCov_9fa48("2654"), "tool_call_end"),
                sequence: stryMutAct_9fa48("2655") ? --this.sequence : (stryCov_9fa48("2655"), ++this.sequence),
                provider: this.provider,
                callRef: stryMutAct_9fa48("2656") ? {} : (stryCov_9fa48("2656"), {
                  sourceKey: stryMutAct_9fa48("2657") ? `` : (stryCov_9fa48("2657"), `output-item:${chunk.item.id}`)
                }),
                reason: stryMutAct_9fa48("2658") ? "" : (stryCov_9fa48("2658"), "complete") // Default complete for item done
              }));
            }
          } else if (stryMutAct_9fa48("2661") ? chunk.type !== "response.completed" : stryMutAct_9fa48("2660") ? false : stryMutAct_9fa48("2659") ? true : (stryCov_9fa48("2659", "2660", "2661"), chunk.type === (stryMutAct_9fa48("2662") ? "" : (stryCov_9fa48("2662"), "response.completed")))) {
            if (stryMutAct_9fa48("2663")) {
              {}
            } else {
              stryCov_9fa48("2663");
              events.push(stryMutAct_9fa48("2664") ? {} : (stryCov_9fa48("2664"), {
                type: stryMutAct_9fa48("2665") ? "" : (stryCov_9fa48("2665"), "provider_stream_end"),
                sequence: stryMutAct_9fa48("2666") ? --this.sequence : (stryCov_9fa48("2666"), ++this.sequence),
                provider: this.provider,
                reason: stryMutAct_9fa48("2667") ? "" : (stryCov_9fa48("2667"), "complete"),
                providerReason: stryMutAct_9fa48("2668") ? chunk.response.status : (stryCov_9fa48("2668"), chunk.response?.status)
              }));
              this.finished = stryMutAct_9fa48("2669") ? false : (stryCov_9fa48("2669"), true);
            }
          } else if (stryMutAct_9fa48("2672") ? chunk.type !== "response.incomplete" : stryMutAct_9fa48("2671") ? false : stryMutAct_9fa48("2670") ? true : (stryCov_9fa48("2670", "2671", "2672"), chunk.type === (stryMutAct_9fa48("2673") ? "" : (stryCov_9fa48("2673"), "response.incomplete")))) {
            if (stryMutAct_9fa48("2674")) {
              {}
            } else {
              stryCov_9fa48("2674");
              events.push(stryMutAct_9fa48("2675") ? {} : (stryCov_9fa48("2675"), {
                type: stryMutAct_9fa48("2676") ? "" : (stryCov_9fa48("2676"), "provider_stream_end"),
                sequence: stryMutAct_9fa48("2677") ? --this.sequence : (stryCov_9fa48("2677"), ++this.sequence),
                provider: this.provider,
                reason: stryMutAct_9fa48("2678") ? "" : (stryCov_9fa48("2678"), "cancelled"),
                // Incomplete treated as cancelled
                providerReason: stryMutAct_9fa48("2679") ? chunk.response.status : (stryCov_9fa48("2679"), chunk.response?.status)
              }));
              this.finished = stryMutAct_9fa48("2680") ? false : (stryCov_9fa48("2680"), true);
            }
          }
          return events;
        }
      }

      // Check if it's the standard tool_calls format
      if (stryMutAct_9fa48("2683") ? chunk.choices?.[0]?.delta?.tool_calls === undefined : stryMutAct_9fa48("2682") ? false : stryMutAct_9fa48("2681") ? true : (stryCov_9fa48("2681", "2682", "2683"), (stryMutAct_9fa48("2686") ? chunk.choices[0]?.delta?.tool_calls : stryMutAct_9fa48("2685") ? chunk.choices?.[0].delta?.tool_calls : stryMutAct_9fa48("2684") ? chunk.choices?.[0]?.delta.tool_calls : (stryCov_9fa48("2684", "2685", "2686"), chunk.choices?.[0]?.delta?.tool_calls)) !== undefined)) {
        if (stryMutAct_9fa48("2687")) {
          {}
        } else {
          stryCov_9fa48("2687");
          // Delegate to OpenAICompatibleStreamAdapter
          const compatibleEvents = this.compatibleAdapter.push(rawEvent);
          // Map provider name to "openai"
          return compatibleEvents.map(stryMutAct_9fa48("2688") ? () => undefined : (stryCov_9fa48("2688"), e => stryMutAct_9fa48("2689") ? {} : (stryCov_9fa48("2689"), {
            ...e,
            provider: this.provider,
            sequence: stryMutAct_9fa48("2690") ? --this.sequence : (stryCov_9fa48("2690"), ++this.sequence)
          })));
        }
      }

      // Handle legacy function_call format
      if (stryMutAct_9fa48("2692") ? false : stryMutAct_9fa48("2691") ? true : (stryCov_9fa48("2691", "2692"), Array.isArray(chunk.choices))) {
        if (stryMutAct_9fa48("2693")) {
          {}
        } else {
          stryCov_9fa48("2693");
          for (const choice of chunk.choices) {
            if (stryMutAct_9fa48("2694")) {
              {}
            } else {
              stryCov_9fa48("2694");
              if (stryMutAct_9fa48("2697") ? choice.delta.function_call : stryMutAct_9fa48("2696") ? false : stryMutAct_9fa48("2695") ? true : (stryCov_9fa48("2695", "2696", "2697"), choice.delta?.function_call)) {
                if (stryMutAct_9fa48("2698")) {
                  {}
                } else {
                  stryCov_9fa48("2698");
                  const fc = choice.delta.function_call;
                  if (stryMutAct_9fa48("2701") ? false : stryMutAct_9fa48("2700") ? true : stryMutAct_9fa48("2699") ? this.hasLegacyFunctionCall : (stryCov_9fa48("2699", "2700", "2701"), !this.hasLegacyFunctionCall)) {
                    if (stryMutAct_9fa48("2702")) {
                      {}
                    } else {
                      stryCov_9fa48("2702");
                      this.hasLegacyFunctionCall = stryMutAct_9fa48("2703") ? false : (stryCov_9fa48("2703"), true);
                      events.push(stryMutAct_9fa48("2704") ? {} : (stryCov_9fa48("2704"), {
                        type: stryMutAct_9fa48("2705") ? "" : (stryCov_9fa48("2705"), "tool_call_start"),
                        sequence: stryMutAct_9fa48("2706") ? --this.sequence : (stryCov_9fa48("2706"), ++this.sequence),
                        provider: this.provider,
                        callRef: stryMutAct_9fa48("2707") ? {} : (stryCov_9fa48("2707"), {
                          sourceKey: this.legacySourceKey
                        }),
                        toolIndex: 0,
                        name: fc.name
                      }));
                    }
                  } else if (stryMutAct_9fa48("2709") ? false : stryMutAct_9fa48("2708") ? true : (stryCov_9fa48("2708", "2709"), fc.name)) {
                    if (stryMutAct_9fa48("2710")) {
                      {}
                    } else {
                      stryCov_9fa48("2710");
                      events.push(stryMutAct_9fa48("2711") ? {} : (stryCov_9fa48("2711"), {
                        type: stryMutAct_9fa48("2712") ? "" : (stryCov_9fa48("2712"), "tool_call_name_delta"),
                        sequence: stryMutAct_9fa48("2713") ? --this.sequence : (stryCov_9fa48("2713"), ++this.sequence),
                        provider: this.provider,
                        callRef: stryMutAct_9fa48("2714") ? {} : (stryCov_9fa48("2714"), {
                          sourceKey: this.legacySourceKey
                        }),
                        delta: fc.name
                      }));
                    }
                  }
                  if (stryMutAct_9fa48("2716") ? false : stryMutAct_9fa48("2715") ? true : (stryCov_9fa48("2715", "2716"), fc.arguments)) {
                    if (stryMutAct_9fa48("2717")) {
                      {}
                    } else {
                      stryCov_9fa48("2717");
                      events.push(stryMutAct_9fa48("2718") ? {} : (stryCov_9fa48("2718"), {
                        type: stryMutAct_9fa48("2719") ? "" : (stryCov_9fa48("2719"), "tool_call_arguments_delta"),
                        sequence: stryMutAct_9fa48("2720") ? --this.sequence : (stryCov_9fa48("2720"), ++this.sequence),
                        provider: this.provider,
                        callRef: stryMutAct_9fa48("2721") ? {} : (stryCov_9fa48("2721"), {
                          sourceKey: this.legacySourceKey
                        }),
                        delta: fc.arguments
                      }));
                    }
                  }
                }
              }
              if (stryMutAct_9fa48("2724") ? choice.finish_reason == null : stryMutAct_9fa48("2723") ? false : stryMutAct_9fa48("2722") ? true : (stryCov_9fa48("2722", "2723", "2724"), choice.finish_reason != null)) {
                if (stryMutAct_9fa48("2725")) {
                  {}
                } else {
                  stryCov_9fa48("2725");
                  let reason: StreamEndReason = stryMutAct_9fa48("2726") ? "" : (stryCov_9fa48("2726"), "unknown");
                  if (stryMutAct_9fa48("2729") ? (choice.finish_reason === "stop" || choice.finish_reason === "function_call") && choice.finish_reason === "tool_calls" : stryMutAct_9fa48("2728") ? false : stryMutAct_9fa48("2727") ? true : (stryCov_9fa48("2727", "2728", "2729"), (stryMutAct_9fa48("2731") ? choice.finish_reason === "stop" && choice.finish_reason === "function_call" : stryMutAct_9fa48("2730") ? false : (stryCov_9fa48("2730", "2731"), (stryMutAct_9fa48("2733") ? choice.finish_reason !== "stop" : stryMutAct_9fa48("2732") ? false : (stryCov_9fa48("2732", "2733"), choice.finish_reason === (stryMutAct_9fa48("2734") ? "" : (stryCov_9fa48("2734"), "stop")))) || (stryMutAct_9fa48("2736") ? choice.finish_reason !== "function_call" : stryMutAct_9fa48("2735") ? false : (stryCov_9fa48("2735", "2736"), choice.finish_reason === (stryMutAct_9fa48("2737") ? "" : (stryCov_9fa48("2737"), "function_call")))))) || (stryMutAct_9fa48("2739") ? choice.finish_reason !== "tool_calls" : stryMutAct_9fa48("2738") ? false : (stryCov_9fa48("2738", "2739"), choice.finish_reason === (stryMutAct_9fa48("2740") ? "" : (stryCov_9fa48("2740"), "tool_calls")))))) {
                    if (stryMutAct_9fa48("2741")) {
                      {}
                    } else {
                      stryCov_9fa48("2741");
                      reason = stryMutAct_9fa48("2742") ? "" : (stryCov_9fa48("2742"), "complete");
                    }
                  } else if (stryMutAct_9fa48("2745") ? choice.finish_reason !== "length" : stryMutAct_9fa48("2744") ? false : stryMutAct_9fa48("2743") ? true : (stryCov_9fa48("2743", "2744", "2745"), choice.finish_reason === (stryMutAct_9fa48("2746") ? "" : (stryCov_9fa48("2746"), "length")))) {
                    if (stryMutAct_9fa48("2747")) {
                      {}
                    } else {
                      stryCov_9fa48("2747");
                      reason = stryMutAct_9fa48("2748") ? "" : (stryCov_9fa48("2748"), "length");
                    }
                  } else if (stryMutAct_9fa48("2751") ? choice.finish_reason !== "cancelled" : stryMutAct_9fa48("2750") ? false : stryMutAct_9fa48("2749") ? true : (stryCov_9fa48("2749", "2750", "2751"), choice.finish_reason === (stryMutAct_9fa48("2752") ? "" : (stryCov_9fa48("2752"), "cancelled")))) {
                    if (stryMutAct_9fa48("2753")) {
                      {}
                    } else {
                      stryCov_9fa48("2753");
                      reason = stryMutAct_9fa48("2754") ? "" : (stryCov_9fa48("2754"), "cancelled");
                    }
                  }
                  events.push(stryMutAct_9fa48("2755") ? {} : (stryCov_9fa48("2755"), {
                    type: stryMutAct_9fa48("2756") ? "" : (stryCov_9fa48("2756"), "provider_stream_end"),
                    sequence: stryMutAct_9fa48("2757") ? --this.sequence : (stryCov_9fa48("2757"), ++this.sequence),
                    provider: this.provider,
                    reason,
                    providerReason: choice.finish_reason
                  }));
                  this.finished = stryMutAct_9fa48("2758") ? false : (stryCov_9fa48("2758"), true);
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
    if (stryMutAct_9fa48("2759")) {
      {}
    } else {
      stryCov_9fa48("2759");
      if (stryMutAct_9fa48("2761") ? false : stryMutAct_9fa48("2760") ? true : (stryCov_9fa48("2760", "2761"), this.finished)) return stryMutAct_9fa48("2762") ? ["Stryker was here"] : (stryCov_9fa48("2762"), []);
      this.finished = stryMutAct_9fa48("2763") ? false : (stryCov_9fa48("2763"), true);
      const compatibleEvents = this.compatibleAdapter.finish(meta);
      if (stryMutAct_9fa48("2766") ? compatibleEvents.length > 0 || !this.hasLegacyFunctionCall : stryMutAct_9fa48("2765") ? false : stryMutAct_9fa48("2764") ? true : (stryCov_9fa48("2764", "2765", "2766"), (stryMutAct_9fa48("2769") ? compatibleEvents.length <= 0 : stryMutAct_9fa48("2768") ? compatibleEvents.length >= 0 : stryMutAct_9fa48("2767") ? true : (stryCov_9fa48("2767", "2768", "2769"), compatibleEvents.length > 0)) && (stryMutAct_9fa48("2770") ? this.hasLegacyFunctionCall : (stryCov_9fa48("2770"), !this.hasLegacyFunctionCall)))) {
        if (stryMutAct_9fa48("2771")) {
          {}
        } else {
          stryCov_9fa48("2771");
          return compatibleEvents.map(stryMutAct_9fa48("2772") ? () => undefined : (stryCov_9fa48("2772"), e => stryMutAct_9fa48("2773") ? {} : (stryCov_9fa48("2773"), {
            ...e,
            provider: this.provider,
            sequence: stryMutAct_9fa48("2774") ? --this.sequence : (stryCov_9fa48("2774"), ++this.sequence)
          })));
        }
      }
      return stryMutAct_9fa48("2775") ? [] : (stryCov_9fa48("2775"), [stryMutAct_9fa48("2776") ? {} : (stryCov_9fa48("2776"), {
        type: stryMutAct_9fa48("2777") ? "" : (stryCov_9fa48("2777"), "provider_stream_end"),
        sequence: stryMutAct_9fa48("2778") ? --this.sequence : (stryCov_9fa48("2778"), ++this.sequence),
        provider: this.provider,
        reason: stryMutAct_9fa48("2779") ? meta?.reason && "unknown" : (stryCov_9fa48("2779"), (stryMutAct_9fa48("2780") ? meta.reason : (stryCov_9fa48("2780"), meta?.reason)) ?? (stryMutAct_9fa48("2781") ? "" : (stryCov_9fa48("2781"), "unknown"))),
        providerReason: stryMutAct_9fa48("2782") ? meta.providerReason : (stryCov_9fa48("2782"), meta?.providerReason)
      })]);
    }
  }
}