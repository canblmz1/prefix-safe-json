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
import { IncrementalJsonParser } from "../types.js";
import { createParser } from "../parser.js";
import { NormalizedToolStreamEvent, ProviderName, StreamEndReason } from "./protocol.js";
import { ToolCallStreamCoordinator, ToolCallCoordinatorSnapshot, ToolCallCoordinatorEvent, ToolCallCoordinatorFinalResult, CoordinatorPushResult, CoordinatorLimits, DEFAULT_COORDINATOR_LIMITS, ToolCallState, CoordinatorDiagnostic } from "./types.js";
class CoordinatorCallState {
  readonly internalId: string;
  readonly provider: ProviderName;
  toolCallId?: string;
  toolIndex?: number;
  name?: string;
  nameComplete: boolean = stryMutAct_9fa48("0") ? true : (stryCov_9fa48("0"), false);
  argumentStreamClosed: boolean = stryMutAct_9fa48("1") ? true : (stryCov_9fa48("1"), false);
  readonly parser: IncrementalJsonParser;
  status: ToolCallState["status"] = stryMutAct_9fa48("2") ? "" : (stryCov_9fa48("2"), "collecting");
  constructor(internalId: string, provider: ProviderName, parser: IncrementalJsonParser) {
    if (stryMutAct_9fa48("3")) {
      {}
    } else {
      stryCov_9fa48("3");
      this.internalId = internalId;
      this.provider = provider;
      this.parser = parser;
    }
  }
}
export class DefaultToolCallStreamCoordinator implements ToolCallStreamCoordinator {
  private readonly limits: CoordinatorLimits;
  private calls: Map<string, CoordinatorCallState> = new Map();
  private sourceKeyToInternalId: Map<string, string> = new Map();
  private callCounter = 0;
  private eventQueue: ToolCallCoordinatorEvent[] = stryMutAct_9fa48("4") ? ["Stryker was here"] : (stryCov_9fa48("4"), []);
  private diagnostics: CoordinatorDiagnostic[] = stryMutAct_9fa48("5") ? ["Stryker was here"] : (stryCov_9fa48("5"), []);
  private eventsProcessed = 0;
  private globalSequence = 0;
  private isFinished = stryMutAct_9fa48("6") ? true : (stryCov_9fa48("6"), false);
  constructor(limits?: Partial<CoordinatorLimits>) {
    if (stryMutAct_9fa48("7")) {
      {}
    } else {
      stryCov_9fa48("7");
      this.limits = stryMutAct_9fa48("8") ? {} : (stryCov_9fa48("8"), {
        ...DEFAULT_COORDINATOR_LIMITS,
        ...limits
      });
    }
  }
  push(event: NormalizedToolStreamEvent): CoordinatorPushResult {
    if (stryMutAct_9fa48("9")) {
      {}
    } else {
      stryCov_9fa48("9");
      if (stryMutAct_9fa48("11") ? false : stryMutAct_9fa48("10") ? true : (stryCov_9fa48("10", "11"), this.isFinished)) {
        if (stryMutAct_9fa48("12")) {
          {}
        } else {
          stryCov_9fa48("12");
          this.addDiagnostic(stryMutAct_9fa48("13") ? {} : (stryCov_9fa48("13"), {
            code: stryMutAct_9fa48("14") ? "" : (stryCov_9fa48("14"), "E_EVENT_AFTER_STREAM_END"),
            severity: stryMutAct_9fa48("15") ? "" : (stryCov_9fa48("15"), "error"),
            message: stryMutAct_9fa48("16") ? "" : (stryCov_9fa48("16"), "Event pushed after stream end")
          }));
          return stryMutAct_9fa48("17") ? {} : (stryCov_9fa48("17"), {
            accepted: stryMutAct_9fa48("18") ? true : (stryCov_9fa48("18"), false)
          });
        }
      }
      if (stryMutAct_9fa48("22") ? this.eventsProcessed < this.limits.maxNormalizedEvents : stryMutAct_9fa48("21") ? this.eventsProcessed > this.limits.maxNormalizedEvents : stryMutAct_9fa48("20") ? false : stryMutAct_9fa48("19") ? true : (stryCov_9fa48("19", "20", "21", "22"), this.eventsProcessed >= this.limits.maxNormalizedEvents)) {
        if (stryMutAct_9fa48("23")) {
          {}
        } else {
          stryCov_9fa48("23");
          this.addDiagnostic(stryMutAct_9fa48("24") ? {} : (stryCov_9fa48("24"), {
            code: stryMutAct_9fa48("25") ? "" : (stryCov_9fa48("25"), "E_COORDINATOR_LIMIT_EVENTS"),
            severity: stryMutAct_9fa48("26") ? "" : (stryCov_9fa48("26"), "fatal"),
            message: stryMutAct_9fa48("27") ? "" : (stryCov_9fa48("27"), "Maximum normalized events exceeded")
          }));
          return stryMutAct_9fa48("28") ? {} : (stryCov_9fa48("28"), {
            accepted: stryMutAct_9fa48("29") ? true : (stryCov_9fa48("29"), false)
          });
        }
      }
      stryMutAct_9fa48("30") ? this.eventsProcessed-- : (stryCov_9fa48("30"), this.eventsProcessed++);
      switch (event.type) {
        case stryMutAct_9fa48("32") ? "" : (stryCov_9fa48("32"), "tool_call_start"):
          if (stryMutAct_9fa48("31")) {} else {
            stryCov_9fa48("31");
            this.handleStart(event);
            break;
          }
        case stryMutAct_9fa48("34") ? "" : (stryCov_9fa48("34"), "tool_call_identity"):
          if (stryMutAct_9fa48("33")) {} else {
            stryCov_9fa48("33");
            this.handleIdentity(event);
            break;
          }
        case stryMutAct_9fa48("36") ? "" : (stryCov_9fa48("36"), "tool_call_name_delta"):
          if (stryMutAct_9fa48("35")) {} else {
            stryCov_9fa48("35");
            this.handleNameDelta(event);
            break;
          }
        case stryMutAct_9fa48("38") ? "" : (stryCov_9fa48("38"), "tool_call_arguments_delta"):
          if (stryMutAct_9fa48("37")) {} else {
            stryCov_9fa48("37");
            this.handleArgumentsDelta(event);
            break;
          }
        case stryMutAct_9fa48("40") ? "" : (stryCov_9fa48("40"), "tool_call_end"):
          if (stryMutAct_9fa48("39")) {} else {
            stryCov_9fa48("39");
            this.handleCallEnd(event);
            break;
          }
        case stryMutAct_9fa48("42") ? "" : (stryCov_9fa48("42"), "provider_diagnostic"):
          if (stryMutAct_9fa48("41")) {} else {
            stryCov_9fa48("41");
            this.handleProviderDiagnostic(event);
            break;
          }
        case stryMutAct_9fa48("44") ? "" : (stryCov_9fa48("44"), "provider_stream_end"):
          if (stryMutAct_9fa48("43")) {} else {
            stryCov_9fa48("43");
            this.handleStreamEnd(event);
            break;
          }
      }
      return stryMutAct_9fa48("45") ? {} : (stryCov_9fa48("45"), {
        accepted: stryMutAct_9fa48("46") ? false : (stryCov_9fa48("46"), true)
      });
    }
  }
  private handleStart(event: NormalizedToolStreamEvent & {
    type: "tool_call_start";
  }) {
    if (stryMutAct_9fa48("47")) {
      {}
    } else {
      stryCov_9fa48("47");
      const sourceKey = event.callRef.sourceKey;
      const existingId = this.sourceKeyToInternalId.get(sourceKey);
      if (stryMutAct_9fa48("50") ? existingId === undefined : stryMutAct_9fa48("49") ? false : stryMutAct_9fa48("48") ? true : (stryCov_9fa48("48", "49", "50"), existingId !== undefined)) {
        if (stryMutAct_9fa48("51")) {
          {}
        } else {
          stryCov_9fa48("51");
          this.addDiagnostic(stryMutAct_9fa48("52") ? {} : (stryCov_9fa48("52"), {
            code: stryMutAct_9fa48("53") ? "" : (stryCov_9fa48("53"), "E_DUPLICATE_TOOL_CALL_START"),
            severity: stryMutAct_9fa48("54") ? "" : (stryCov_9fa48("54"), "error"),
            internalId: existingId,
            message: stryMutAct_9fa48("55") ? `` : (stryCov_9fa48("55"), `Duplicate start for tool call sourceKey: ${sourceKey}`)
          }));
          return;
        }
      }
      if (stryMutAct_9fa48("59") ? this.calls.size < this.limits.maxToolCalls : stryMutAct_9fa48("58") ? this.calls.size > this.limits.maxToolCalls : stryMutAct_9fa48("57") ? false : stryMutAct_9fa48("56") ? true : (stryCov_9fa48("56", "57", "58", "59"), this.calls.size >= this.limits.maxToolCalls)) {
        if (stryMutAct_9fa48("60")) {
          {}
        } else {
          stryCov_9fa48("60");
          this.addDiagnostic(stryMutAct_9fa48("61") ? {} : (stryCov_9fa48("61"), {
            code: stryMutAct_9fa48("62") ? "" : (stryCov_9fa48("62"), "E_COORDINATOR_LIMIT_CALLS"),
            severity: stryMutAct_9fa48("63") ? "" : (stryCov_9fa48("63"), "error"),
            message: stryMutAct_9fa48("64") ? "" : (stryCov_9fa48("64"), "Maximum tool calls exceeded")
          }));
          return;
        }
      }
      const internalId = stryMutAct_9fa48("65") ? `` : (stryCov_9fa48("65"), `call-${stryMutAct_9fa48("66") ? this.callCounter-- : (stryCov_9fa48("66"), this.callCounter++)}`);
      this.sourceKeyToInternalId.set(sourceKey, internalId);
      const parser = createParser(); // Using default parser limits for now
      const call = new CoordinatorCallState(internalId, event.provider, parser);
      if (stryMutAct_9fa48("69") ? event.toolCallId === undefined : stryMutAct_9fa48("68") ? false : stryMutAct_9fa48("67") ? true : (stryCov_9fa48("67", "68", "69"), event.toolCallId !== undefined)) call.toolCallId = event.toolCallId;
      if (stryMutAct_9fa48("72") ? event.toolIndex === undefined : stryMutAct_9fa48("71") ? false : stryMutAct_9fa48("70") ? true : (stryCov_9fa48("70", "71", "72"), event.toolIndex !== undefined)) call.toolIndex = event.toolIndex;
      if (stryMutAct_9fa48("75") ? event.name === undefined : stryMutAct_9fa48("74") ? false : stryMutAct_9fa48("73") ? true : (stryCov_9fa48("73", "74", "75"), event.name !== undefined)) call.name = event.name;
      this.calls.set(internalId, call);
      this.eventQueue.push(stryMutAct_9fa48("76") ? {} : (stryCov_9fa48("76"), {
        type: stryMutAct_9fa48("77") ? "" : (stryCov_9fa48("77"), "tool_call_discovered"),
        sequence: stryMutAct_9fa48("78") ? this.globalSequence-- : (stryCov_9fa48("78"), this.globalSequence++),
        internalId,
        provider: event.provider
      }));
      if (stryMutAct_9fa48("81") ? event.toolCallId !== undefined && event.toolIndex !== undefined : stryMutAct_9fa48("80") ? false : stryMutAct_9fa48("79") ? true : (stryCov_9fa48("79", "80", "81"), (stryMutAct_9fa48("83") ? event.toolCallId === undefined : stryMutAct_9fa48("82") ? false : (stryCov_9fa48("82", "83"), event.toolCallId !== undefined)) || (stryMutAct_9fa48("85") ? event.toolIndex === undefined : stryMutAct_9fa48("84") ? false : (stryCov_9fa48("84", "85"), event.toolIndex !== undefined)))) {
        if (stryMutAct_9fa48("86")) {
          {}
        } else {
          stryCov_9fa48("86");
          this.eventQueue.push(stryMutAct_9fa48("87") ? {} : (stryCov_9fa48("87"), {
            type: stryMutAct_9fa48("88") ? "" : (stryCov_9fa48("88"), "tool_call_identity_updated"),
            sequence: stryMutAct_9fa48("89") ? this.globalSequence-- : (stryCov_9fa48("89"), this.globalSequence++),
            internalId,
            toolCallId: event.toolCallId,
            toolIndex: event.toolIndex
          }));
        }
      }
    }
  }
  private handleIdentity(event: NormalizedToolStreamEvent & {
    type: "tool_call_identity";
  }) {
    if (stryMutAct_9fa48("90")) {
      {}
    } else {
      stryCov_9fa48("90");
      const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
      if (stryMutAct_9fa48("93") ? false : stryMutAct_9fa48("92") ? true : stryMutAct_9fa48("91") ? internalId : (stryCov_9fa48("91", "92", "93"), !internalId)) return;
      const call = this.getCall(internalId);
      if (stryMutAct_9fa48("96") ? false : stryMutAct_9fa48("95") ? true : stryMutAct_9fa48("94") ? call : (stryCov_9fa48("94", "95", "96"), !call)) return;
      let changed = stryMutAct_9fa48("97") ? true : (stryCov_9fa48("97"), false);
      if (stryMutAct_9fa48("100") ? event.toolCallId === undefined : stryMutAct_9fa48("99") ? false : stryMutAct_9fa48("98") ? true : (stryCov_9fa48("98", "99", "100"), event.toolCallId !== undefined)) {
        if (stryMutAct_9fa48("101")) {
          {}
        } else {
          stryCov_9fa48("101");
          if (stryMutAct_9fa48("104") ? call.toolCallId !== undefined || call.toolCallId !== event.toolCallId : stryMutAct_9fa48("103") ? false : stryMutAct_9fa48("102") ? true : (stryCov_9fa48("102", "103", "104"), (stryMutAct_9fa48("106") ? call.toolCallId === undefined : stryMutAct_9fa48("105") ? true : (stryCov_9fa48("105", "106"), call.toolCallId !== undefined)) && (stryMutAct_9fa48("108") ? call.toolCallId === event.toolCallId : stryMutAct_9fa48("107") ? true : (stryCov_9fa48("107", "108"), call.toolCallId !== event.toolCallId)))) {
            if (stryMutAct_9fa48("109")) {
              {}
            } else {
              stryCov_9fa48("109");
              this.addDiagnostic(stryMutAct_9fa48("110") ? {} : (stryCov_9fa48("110"), {
                code: stryMutAct_9fa48("111") ? "" : (stryCov_9fa48("111"), "E_PROVIDER_IDENTITY_CONFLICT"),
                severity: stryMutAct_9fa48("112") ? "" : (stryCov_9fa48("112"), "error"),
                internalId: call.internalId,
                message: stryMutAct_9fa48("113") ? `` : (stryCov_9fa48("113"), `Conflicting ID: had ${call.toolCallId}, got ${event.toolCallId}`)
              }));
              call.status = stryMutAct_9fa48("114") ? "" : (stryCov_9fa48("114"), "invalid");
            }
          } else if (stryMutAct_9fa48("117") ? call.toolCallId !== undefined : stryMutAct_9fa48("116") ? false : stryMutAct_9fa48("115") ? true : (stryCov_9fa48("115", "116", "117"), call.toolCallId === undefined)) {
            if (stryMutAct_9fa48("118")) {
              {}
            } else {
              stryCov_9fa48("118");
              call.toolCallId = event.toolCallId;
              changed = stryMutAct_9fa48("119") ? false : (stryCov_9fa48("119"), true);
            }
          }
        }
      }
      if (stryMutAct_9fa48("122") ? event.toolIndex === undefined : stryMutAct_9fa48("121") ? false : stryMutAct_9fa48("120") ? true : (stryCov_9fa48("120", "121", "122"), event.toolIndex !== undefined)) {
        if (stryMutAct_9fa48("123")) {
          {}
        } else {
          stryCov_9fa48("123");
          if (stryMutAct_9fa48("126") ? call.toolIndex !== undefined || call.toolIndex !== event.toolIndex : stryMutAct_9fa48("125") ? false : stryMutAct_9fa48("124") ? true : (stryCov_9fa48("124", "125", "126"), (stryMutAct_9fa48("128") ? call.toolIndex === undefined : stryMutAct_9fa48("127") ? true : (stryCov_9fa48("127", "128"), call.toolIndex !== undefined)) && (stryMutAct_9fa48("130") ? call.toolIndex === event.toolIndex : stryMutAct_9fa48("129") ? true : (stryCov_9fa48("129", "130"), call.toolIndex !== event.toolIndex)))) {
            if (stryMutAct_9fa48("131")) {
              {}
            } else {
              stryCov_9fa48("131");
              this.addDiagnostic(stryMutAct_9fa48("132") ? {} : (stryCov_9fa48("132"), {
                code: stryMutAct_9fa48("133") ? "" : (stryCov_9fa48("133"), "E_PROVIDER_INDEX_CONFLICT"),
                severity: stryMutAct_9fa48("134") ? "" : (stryCov_9fa48("134"), "error"),
                internalId: call.internalId,
                message: stryMutAct_9fa48("135") ? `` : (stryCov_9fa48("135"), `Conflicting index: had ${call.toolIndex}, got ${event.toolIndex}`)
              }));
              call.status = stryMutAct_9fa48("136") ? "" : (stryCov_9fa48("136"), "invalid");
            }
          } else if (stryMutAct_9fa48("139") ? call.toolIndex !== undefined : stryMutAct_9fa48("138") ? false : stryMutAct_9fa48("137") ? true : (stryCov_9fa48("137", "138", "139"), call.toolIndex === undefined)) {
            if (stryMutAct_9fa48("140")) {
              {}
            } else {
              stryCov_9fa48("140");
              call.toolIndex = event.toolIndex;
              changed = stryMutAct_9fa48("141") ? false : (stryCov_9fa48("141"), true);
            }
          }
        }
      }
      if (stryMutAct_9fa48("143") ? false : stryMutAct_9fa48("142") ? true : (stryCov_9fa48("142", "143"), changed)) {
        if (stryMutAct_9fa48("144")) {
          {}
        } else {
          stryCov_9fa48("144");
          this.eventQueue.push(stryMutAct_9fa48("145") ? {} : (stryCov_9fa48("145"), {
            type: stryMutAct_9fa48("146") ? "" : (stryCov_9fa48("146"), "tool_call_identity_updated"),
            sequence: stryMutAct_9fa48("147") ? this.globalSequence-- : (stryCov_9fa48("147"), this.globalSequence++),
            internalId: call.internalId,
            toolCallId: call.toolCallId,
            toolIndex: call.toolIndex
          }));
        }
      }
    }
  }
  private handleNameDelta(event: NormalizedToolStreamEvent & {
    type: "tool_call_name_delta";
  }) {
    if (stryMutAct_9fa48("148")) {
      {}
    } else {
      stryCov_9fa48("148");
      const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
      if (stryMutAct_9fa48("151") ? false : stryMutAct_9fa48("150") ? true : stryMutAct_9fa48("149") ? internalId : (stryCov_9fa48("149", "150", "151"), !internalId)) return;
      const call = this.getCall(internalId);
      if (stryMutAct_9fa48("154") ? false : stryMutAct_9fa48("153") ? true : stryMutAct_9fa48("152") ? call : (stryCov_9fa48("152", "153", "154"), !call)) return;
      if (stryMutAct_9fa48("157") ? call.status === "collecting" : stryMutAct_9fa48("156") ? false : stryMutAct_9fa48("155") ? true : (stryCov_9fa48("155", "156", "157"), call.status !== (stryMutAct_9fa48("158") ? "" : (stryCov_9fa48("158"), "collecting")))) {
        if (stryMutAct_9fa48("159")) {
          {}
        } else {
          stryCov_9fa48("159");
          this.addDiagnostic(stryMutAct_9fa48("160") ? {} : (stryCov_9fa48("160"), {
            code: stryMutAct_9fa48("161") ? "" : (stryCov_9fa48("161"), "E_NAME_DELTA_AFTER_END"),
            severity: stryMutAct_9fa48("162") ? "" : (stryCov_9fa48("162"), "error"),
            internalId: call.internalId,
            message: stryMutAct_9fa48("163") ? "" : (stryCov_9fa48("163"), "Name delta after call ended")
          }));
          return;
        }
      }
      call.name = stryMutAct_9fa48("164") ? (call.name ?? "") - event.delta : (stryCov_9fa48("164"), (stryMutAct_9fa48("165") ? call.name && "" : (stryCov_9fa48("165"), call.name ?? (stryMutAct_9fa48("166") ? "Stryker was here!" : (stryCov_9fa48("166"), "")))) + event.delta);
      if (stryMutAct_9fa48("170") ? call.name.length <= this.limits.maxToolNameBytes : stryMutAct_9fa48("169") ? call.name.length >= this.limits.maxToolNameBytes : stryMutAct_9fa48("168") ? false : stryMutAct_9fa48("167") ? true : (stryCov_9fa48("167", "168", "169", "170"), call.name.length > this.limits.maxToolNameBytes)) {
        if (stryMutAct_9fa48("171")) {
          {}
        } else {
          stryCov_9fa48("171");
          this.addDiagnostic(stryMutAct_9fa48("172") ? {} : (stryCov_9fa48("172"), {
            code: stryMutAct_9fa48("173") ? "" : (stryCov_9fa48("173"), "E_TOOL_NAME_LIMIT"),
            severity: stryMutAct_9fa48("174") ? "" : (stryCov_9fa48("174"), "error"),
            internalId: call.internalId,
            message: stryMutAct_9fa48("175") ? "" : (stryCov_9fa48("175"), "Tool name exceeded maximum length")
          }));
          call.status = stryMutAct_9fa48("176") ? "" : (stryCov_9fa48("176"), "invalid");
        }
      }
      this.eventQueue.push(stryMutAct_9fa48("177") ? {} : (stryCov_9fa48("177"), {
        type: stryMutAct_9fa48("178") ? "" : (stryCov_9fa48("178"), "tool_name_updated"),
        sequence: event.sequence,
        internalId: call.internalId,
        name: call.name,
        complete: stryMutAct_9fa48("179") ? true : (stryCov_9fa48("179"), false)
      }));
    }
  }
  private handleArgumentsDelta(event: NormalizedToolStreamEvent & {
    type: "tool_call_arguments_delta";
  }) {
    if (stryMutAct_9fa48("180")) {
      {}
    } else {
      stryCov_9fa48("180");
      const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
      if (stryMutAct_9fa48("183") ? false : stryMutAct_9fa48("182") ? true : stryMutAct_9fa48("181") ? internalId : (stryCov_9fa48("181", "182", "183"), !internalId)) return;
      const call = this.getCall(internalId);
      if (stryMutAct_9fa48("186") ? false : stryMutAct_9fa48("185") ? true : stryMutAct_9fa48("184") ? call : (stryCov_9fa48("184", "185", "186"), !call)) return;
      if (stryMutAct_9fa48("189") ? call.status === "collecting" : stryMutAct_9fa48("188") ? false : stryMutAct_9fa48("187") ? true : (stryCov_9fa48("187", "188", "189"), call.status !== (stryMutAct_9fa48("190") ? "" : (stryCov_9fa48("190"), "collecting")))) {
        if (stryMutAct_9fa48("191")) {
          {}
        } else {
          stryCov_9fa48("191");
          this.addDiagnostic(stryMutAct_9fa48("192") ? {} : (stryCov_9fa48("192"), {
            code: stryMutAct_9fa48("193") ? "" : (stryCov_9fa48("193"), "E_ARGUMENT_DELTA_AFTER_END"),
            severity: stryMutAct_9fa48("194") ? "" : (stryCov_9fa48("194"), "error"),
            internalId: call.internalId,
            message: stryMutAct_9fa48("195") ? "" : (stryCov_9fa48("195"), "Argument delta after call ended")
          }));
          return;
        }
      }
      call.parser.push(event.delta);

      // Drain parser events and map them to coordinator events
      const parserEvents = call.parser.drainEvents();
      for (const pe of parserEvents) {
        if (stryMutAct_9fa48("196")) {
          {}
        } else {
          stryCov_9fa48("196");
          this.eventQueue.push(stryMutAct_9fa48("197") ? {} : (stryCov_9fa48("197"), {
            type: stryMutAct_9fa48("198") ? "" : (stryCov_9fa48("198"), "tool_argument_event"),
            sequence: stryMutAct_9fa48("199") ? this.globalSequence-- : (stryCov_9fa48("199"), this.globalSequence++),
            internalId: call.internalId,
            event: pe
          }));
        }
      }
    }
  }
  private handleCallEnd(event: NormalizedToolStreamEvent & {
    type: "tool_call_end";
  }) {
    if (stryMutAct_9fa48("200")) {
      {}
    } else {
      stryCov_9fa48("200");
      const internalId = this.sourceKeyToInternalId.get(event.callRef.sourceKey);
      if (stryMutAct_9fa48("203") ? false : stryMutAct_9fa48("202") ? true : stryMutAct_9fa48("201") ? internalId : (stryCov_9fa48("201", "202", "203"), !internalId)) return;
      const call = this.getCall(internalId);
      if (stryMutAct_9fa48("206") ? false : stryMutAct_9fa48("205") ? true : stryMutAct_9fa48("204") ? call : (stryCov_9fa48("204", "205", "206"), !call)) return;
      if (stryMutAct_9fa48("209") ? call.status === "collecting" : stryMutAct_9fa48("208") ? false : stryMutAct_9fa48("207") ? true : (stryCov_9fa48("207", "208", "209"), call.status !== (stryMutAct_9fa48("210") ? "" : (stryCov_9fa48("210"), "collecting")))) return;
      call.nameComplete = stryMutAct_9fa48("211") ? false : (stryCov_9fa48("211"), true);
      call.argumentStreamClosed = stryMutAct_9fa48("212") ? false : (stryCov_9fa48("212"), true);
      if (stryMutAct_9fa48("215") ? call.name === undefined : stryMutAct_9fa48("214") ? false : stryMutAct_9fa48("213") ? true : (stryCov_9fa48("213", "214", "215"), call.name !== undefined)) {
        if (stryMutAct_9fa48("216")) {
          {}
        } else {
          stryCov_9fa48("216");
          this.eventQueue.push(stryMutAct_9fa48("217") ? {} : (stryCov_9fa48("217"), {
            type: stryMutAct_9fa48("218") ? "" : (stryCov_9fa48("218"), "tool_name_updated"),
            sequence: stryMutAct_9fa48("219") ? this.globalSequence-- : (stryCov_9fa48("219"), this.globalSequence++),
            internalId: call.internalId,
            name: call.name,
            complete: stryMutAct_9fa48("220") ? false : (stryCov_9fa48("220"), true)
          }));
        }
      } else {
        if (stryMutAct_9fa48("221")) {
          {}
        } else {
          stryCov_9fa48("221");
          this.addDiagnostic(stryMutAct_9fa48("222") ? {} : (stryCov_9fa48("222"), {
            code: stryMutAct_9fa48("223") ? "" : (stryCov_9fa48("223"), "E_TOOL_NAME_MISSING"),
            severity: stryMutAct_9fa48("224") ? "" : (stryCov_9fa48("224"), "error"),
            internalId: call.internalId,
            message: stryMutAct_9fa48("225") ? "" : (stryCov_9fa48("225"), "Tool name missing at end")
          }));
        }
      }
    }
  }
  private finishCall(call: CoordinatorCallState, reason: StreamEndReason) {
    if (stryMutAct_9fa48("226")) {
      {}
    } else {
      stryCov_9fa48("226");
      if (stryMutAct_9fa48("229") ? call.status === "collecting" : stryMutAct_9fa48("228") ? false : stryMutAct_9fa48("227") ? true : (stryCov_9fa48("227", "228", "229"), call.status !== (stryMutAct_9fa48("230") ? "" : (stryCov_9fa48("230"), "collecting")))) return;

      // For individual call end, we pass reason to the internal parser
      const res = call.parser.finish(stryMutAct_9fa48("231") ? {} : (stryCov_9fa48("231"), {
        reason
      }));

      // Determine the mapped coordinator outcome
      let outcome: ToolCallState["status"] = stryMutAct_9fa48("232") ? "" : (stryCov_9fa48("232"), "invalid");
      if (stryMutAct_9fa48("235") ? res.outcome !== "valid" : stryMutAct_9fa48("234") ? false : stryMutAct_9fa48("233") ? true : (stryCov_9fa48("233", "234", "235"), res.outcome === (stryMutAct_9fa48("236") ? "" : (stryCov_9fa48("236"), "valid")))) {
        if (stryMutAct_9fa48("237")) {
          {}
        } else {
          stryCov_9fa48("237");
          outcome = stryMutAct_9fa48("238") ? "" : (stryCov_9fa48("238"), "complete");
          if (stryMutAct_9fa48("241") ? call.name === undefined && this.hasCallConflict(call) : stryMutAct_9fa48("240") ? false : stryMutAct_9fa48("239") ? true : (stryCov_9fa48("239", "240", "241"), (stryMutAct_9fa48("243") ? call.name !== undefined : stryMutAct_9fa48("242") ? false : (stryCov_9fa48("242", "243"), call.name === undefined)) || this.hasCallConflict(call))) {
            if (stryMutAct_9fa48("244")) {
              {}
            } else {
              stryCov_9fa48("244");
              outcome = stryMutAct_9fa48("245") ? "" : (stryCov_9fa48("245"), "invalid");
            }
          }
        }
      } else if (stryMutAct_9fa48("248") ? res.outcome !== "truncated" : stryMutAct_9fa48("247") ? false : stryMutAct_9fa48("246") ? true : (stryCov_9fa48("246", "247", "248"), res.outcome === (stryMutAct_9fa48("249") ? "" : (stryCov_9fa48("249"), "truncated")))) {
        if (stryMutAct_9fa48("250")) {
          {}
        } else {
          stryCov_9fa48("250");
          outcome = stryMutAct_9fa48("251") ? "" : (stryCov_9fa48("251"), "truncated");
        }
      } else if (stryMutAct_9fa48("254") ? res.outcome !== "salvaged" : stryMutAct_9fa48("253") ? false : stryMutAct_9fa48("252") ? true : (stryCov_9fa48("252", "253", "254"), res.outcome === (stryMutAct_9fa48("255") ? "" : (stryCov_9fa48("255"), "salvaged")))) {
        if (stryMutAct_9fa48("256")) {
          {}
        } else {
          stryCov_9fa48("256");
          outcome = stryMutAct_9fa48("257") ? "" : (stryCov_9fa48("257"), "salvaged");
        }
      }
      if (stryMutAct_9fa48("260") ? reason !== "cancelled" : stryMutAct_9fa48("259") ? false : stryMutAct_9fa48("258") ? true : (stryCov_9fa48("258", "259", "260"), reason === (stryMutAct_9fa48("261") ? "" : (stryCov_9fa48("261"), "cancelled")))) outcome = stryMutAct_9fa48("262") ? "" : (stryCov_9fa48("262"), "cancelled");
      call.status = outcome;

      // Drain remaining parser events
      const parserEvents = call.parser.drainEvents();
      for (const pe of parserEvents) {
        if (stryMutAct_9fa48("263")) {
          {}
        } else {
          stryCov_9fa48("263");
          this.eventQueue.push(stryMutAct_9fa48("264") ? {} : (stryCov_9fa48("264"), {
            type: stryMutAct_9fa48("265") ? "" : (stryCov_9fa48("265"), "tool_argument_event"),
            sequence: stryMutAct_9fa48("266") ? this.globalSequence-- : (stryCov_9fa48("266"), this.globalSequence++),
            internalId: call.internalId,
            event: pe
          }));
        }
      }

      // Determine executable according to Executable Policy
      const executable = stryMutAct_9fa48("269") ? outcome === "complete" || res.executable : stryMutAct_9fa48("268") ? false : stryMutAct_9fa48("267") ? true : (stryCov_9fa48("267", "268", "269"), (stryMutAct_9fa48("271") ? outcome !== "complete" : stryMutAct_9fa48("270") ? true : (stryCov_9fa48("270", "271"), outcome === (stryMutAct_9fa48("272") ? "" : (stryCov_9fa48("272"), "complete")))) && res.executable);
      this.eventQueue.push(stryMutAct_9fa48("273") ? {} : (stryCov_9fa48("273"), {
        type: stryMutAct_9fa48("274") ? "" : (stryCov_9fa48("274"), "tool_call_finished"),
        sequence: stryMutAct_9fa48("275") ? this.globalSequence-- : (stryCov_9fa48("275"), this.globalSequence++),
        internalId: call.internalId,
        outcome,
        executable
      }));
    }
  }
  private hasCallConflict(call: CoordinatorCallState): boolean {
    if (stryMutAct_9fa48("276")) {
      {}
    } else {
      stryCov_9fa48("276");
      return stryMutAct_9fa48("277") ? this.diagnostics.every(d => d.internalId === call.internalId && (d.severity === "error" || d.severity === "fatal")) : (stryCov_9fa48("277"), this.diagnostics.some(stryMutAct_9fa48("278") ? () => undefined : (stryCov_9fa48("278"), d => stryMutAct_9fa48("281") ? d.internalId === call.internalId || d.severity === "error" || d.severity === "fatal" : stryMutAct_9fa48("280") ? false : stryMutAct_9fa48("279") ? true : (stryCov_9fa48("279", "280", "281"), (stryMutAct_9fa48("283") ? d.internalId !== call.internalId : stryMutAct_9fa48("282") ? true : (stryCov_9fa48("282", "283"), d.internalId === call.internalId)) && (stryMutAct_9fa48("285") ? d.severity === "error" && d.severity === "fatal" : stryMutAct_9fa48("284") ? true : (stryCov_9fa48("284", "285"), (stryMutAct_9fa48("287") ? d.severity !== "error" : stryMutAct_9fa48("286") ? false : (stryCov_9fa48("286", "287"), d.severity === (stryMutAct_9fa48("288") ? "" : (stryCov_9fa48("288"), "error")))) || (stryMutAct_9fa48("290") ? d.severity !== "fatal" : stryMutAct_9fa48("289") ? false : (stryCov_9fa48("289", "290"), d.severity === (stryMutAct_9fa48("291") ? "" : (stryCov_9fa48("291"), "fatal"))))))))));
    }
  }
  private handleProviderDiagnostic(event: NormalizedToolStreamEvent & {
    type: "provider_diagnostic";
  }) {
    if (stryMutAct_9fa48("292")) {
      {}
    } else {
      stryCov_9fa48("292");
      const internalId = event.callRef ? this.sourceKeyToInternalId.get(event.callRef.sourceKey) : undefined;
      this.addDiagnostic(stryMutAct_9fa48("293") ? {} : (stryCov_9fa48("293"), {
        code: event.code,
        severity: event.severity,
        message: event.message,
        internalId
      }));
    }
  }
  private handleStreamEnd(event: NormalizedToolStreamEvent & {
    type: "provider_stream_end";
  }) {
    if (stryMutAct_9fa48("294")) {
      {}
    } else {
      stryCov_9fa48("294");
      this.isFinished = stryMutAct_9fa48("295") ? false : (stryCov_9fa48("295"), true);

      // Close all open calls
      for (const call of this.calls.values()) {
        if (stryMutAct_9fa48("296")) {
          {}
        } else {
          stryCov_9fa48("296");
          if (stryMutAct_9fa48("299") ? call.status !== "collecting" : stryMutAct_9fa48("298") ? false : stryMutAct_9fa48("297") ? true : (stryCov_9fa48("297", "298", "299"), call.status === (stryMutAct_9fa48("300") ? "" : (stryCov_9fa48("300"), "collecting")))) {
            if (stryMutAct_9fa48("301")) {
              {}
            } else {
              stryCov_9fa48("301");
              if (stryMutAct_9fa48("304") ? false : stryMutAct_9fa48("303") ? true : stryMutAct_9fa48("302") ? call.argumentStreamClosed : (stryCov_9fa48("302", "303", "304"), !call.argumentStreamClosed)) {
                if (stryMutAct_9fa48("305")) {
                  {}
                } else {
                  stryCov_9fa48("305");
                  this.addDiagnostic(stryMutAct_9fa48("306") ? {} : (stryCov_9fa48("306"), {
                    code: stryMutAct_9fa48("307") ? "" : (stryCov_9fa48("307"), "E_STREAM_ENDED_WITH_OPEN_CALL"),
                    severity: stryMutAct_9fa48("308") ? "" : (stryCov_9fa48("308"), "error"),
                    internalId: call.internalId,
                    message: stryMutAct_9fa48("309") ? "" : (stryCov_9fa48("309"), "Stream ended with open call")
                  }));
                }
              }
              this.finishCall(call, event.reason);
            }
          }
        }
      }
      this.eventQueue.push(stryMutAct_9fa48("310") ? {} : (stryCov_9fa48("310"), {
        type: stryMutAct_9fa48("311") ? "" : (stryCov_9fa48("311"), "provider_stream_finished"),
        sequence: stryMutAct_9fa48("312") ? this.globalSequence-- : (stryCov_9fa48("312"), this.globalSequence++),
        reason: event.reason
      }));
    }
  }
  private getCall(internalId: string): CoordinatorCallState | undefined {
    if (stryMutAct_9fa48("313")) {
      {}
    } else {
      stryCov_9fa48("313");
      const call = this.calls.get(internalId);
      if (stryMutAct_9fa48("316") ? false : stryMutAct_9fa48("315") ? true : stryMutAct_9fa48("314") ? call : (stryCov_9fa48("314", "315", "316"), !call)) {
        if (stryMutAct_9fa48("317")) {
          {}
        } else {
          stryCov_9fa48("317");
          this.addDiagnostic(stryMutAct_9fa48("318") ? {} : (stryCov_9fa48("318"), {
            code: stryMutAct_9fa48("319") ? "" : (stryCov_9fa48("319"), "E_TOOL_CALL_NOT_FOUND"),
            severity: stryMutAct_9fa48("320") ? "" : (stryCov_9fa48("320"), "error"),
            internalId,
            message: stryMutAct_9fa48("321") ? `` : (stryCov_9fa48("321"), `Tool call ${internalId} not found`)
          }));
          return undefined;
        }
      }
      return call;
    }
  }
  private addDiagnostic(diag: CoordinatorDiagnostic) {
    if (stryMutAct_9fa48("322")) {
      {}
    } else {
      stryCov_9fa48("322");
      this.diagnostics.push(diag);
      this.eventQueue.push(stryMutAct_9fa48("323") ? {} : (stryCov_9fa48("323"), {
        type: stryMutAct_9fa48("324") ? "" : (stryCov_9fa48("324"), "coordinator_diagnostic"),
        sequence: stryMutAct_9fa48("325") ? this.globalSequence-- : (stryCov_9fa48("325"), this.globalSequence++),
        diagnostic: diag
      }));
    }
  }
  snapshot(): ToolCallCoordinatorSnapshot {
    if (stryMutAct_9fa48("326")) {
      {}
    } else {
      stryCov_9fa48("326");
      return stryMutAct_9fa48("327") ? {} : (stryCov_9fa48("327"), {
        calls: Array.from(this.calls.values()).map(stryMutAct_9fa48("328") ? () => undefined : (stryCov_9fa48("328"), c => stryMutAct_9fa48("329") ? {} : (stryCov_9fa48("329"), {
          internalId: c.internalId,
          provider: c.provider,
          toolCallId: c.toolCallId,
          toolIndex: c.toolIndex,
          name: c.name,
          nameComplete: c.nameComplete,
          parser: c.parser.snapshot(),
          status: c.status
        }))),
        diagnostics: stryMutAct_9fa48("330") ? [] : (stryCov_9fa48("330"), [...this.diagnostics]),
        eventsProcessed: this.eventsProcessed,
        isFinished: this.isFinished
      });
    }
  }
  drainEvents(): readonly ToolCallCoordinatorEvent[] {
    if (stryMutAct_9fa48("331")) {
      {}
    } else {
      stryCov_9fa48("331");
      const events = this.eventQueue;
      this.eventQueue = stryMutAct_9fa48("332") ? ["Stryker was here"] : (stryCov_9fa48("332"), []);
      return events;
    }
  }
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): ToolCallCoordinatorFinalResult {
    if (stryMutAct_9fa48("333")) {
      {}
    } else {
      stryCov_9fa48("333");
      if (stryMutAct_9fa48("336") ? false : stryMutAct_9fa48("335") ? true : stryMutAct_9fa48("334") ? this.isFinished : (stryCov_9fa48("334", "335", "336"), !this.isFinished)) {
        if (stryMutAct_9fa48("337")) {
          {}
        } else {
          stryCov_9fa48("337");
          this.handleStreamEnd(stryMutAct_9fa48("338") ? {} : (stryCov_9fa48("338"), {
            type: stryMutAct_9fa48("339") ? "" : (stryCov_9fa48("339"), "provider_stream_end"),
            sequence: stryMutAct_9fa48("340") ? this.eventsProcessed - 1 : (stryCov_9fa48("340"), this.eventsProcessed + 1),
            provider: stryMutAct_9fa48("341") ? "" : (stryCov_9fa48("341"), "unknown"),
            reason: stryMutAct_9fa48("342") ? meta?.reason && "unknown" : (stryCov_9fa48("342"), (stryMutAct_9fa48("343") ? meta.reason : (stryCov_9fa48("343"), meta?.reason)) ?? (stryMutAct_9fa48("344") ? "" : (stryCov_9fa48("344"), "unknown"))),
            providerReason: stryMutAct_9fa48("345") ? meta.providerReason : (stryCov_9fa48("345"), meta?.providerReason)
          }));
        }
      }
      return stryMutAct_9fa48("346") ? {} : (stryCov_9fa48("346"), {
        calls: this.snapshot().calls
      });
    }
  }
}
export function createToolCallStreamCoordinator(limits?: Partial<CoordinatorLimits>): ToolCallStreamCoordinator {
  if (stryMutAct_9fa48("347")) {
    {}
  } else {
    stryCov_9fa48("347");
    return new DefaultToolCallStreamCoordinator(limits);
  }
}