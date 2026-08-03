// @ts-nocheck
// ---------------------------------------------------------------------------
// IncrementalJsonParser — main parser implementation
// ---------------------------------------------------------------------------
//
// Integrates: UTF-8 decoder → Lexer/Scanner → Grammar Stack → Event Builder
//
// Public API: push(), snapshot(), drainEvents(), finish()
// ---------------------------------------------------------------------------
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
import type { IncrementalJsonParser, ParserOptions, ParserLimits, PushResult, ParserSnapshot, ParserEvent, FinalResult, SyntaxStatus, PendingToken, Diagnostic, RepairAction, RepairOptions, JsonValue, StreamEndReason } from "./types.js";
import { DiagnosticCode } from "./diagnostics/codes.js";
import { DEFAULT_LIMITS } from "./limits.js";
import { Utf8Decoder, stringToUtf8 } from "./utf8/decoder.js";
import { Scanner } from "./lexer/scanner.js";
import { ScannerState } from "./lexer/states.js";
import { TokenType } from "./lexer/tokens.js";
import type { Token } from "./lexer/tokens.js";
import { GrammarStack } from "./grammar/stack.js";
import { EventBuilder } from "./semantic/builder.js";
import { SnapshotBuilder } from "./semantic/snapshot.js";
import { createDiagnostic } from "./diagnostics/factory.js";

/**
 * Create a new IncrementalJsonParser.
 */
export function createParser(options?: ParserOptions): IncrementalJsonParser {
  if (stryMutAct_9fa48("1131")) {
    {}
  } else {
    stryCov_9fa48("1131");
    return new Parser(options);
  }
}
class Parser implements IncrementalJsonParser {
  private readonly limits: ParserLimits;
  private readonly utf8: Utf8Decoder;
  private readonly scanner: Scanner;
  private readonly grammar: GrammarStack;
  private readonly events: EventBuilder;
  private readonly snapshot_: SnapshotBuilder;
  private readonly allDiagnostics: Diagnostic[] = stryMutAct_9fa48("1132") ? ["Stryker was here"] : (stryCov_9fa48("1132"), []);
  private readonly allRepairs: RepairAction[] = stryMutAct_9fa48("1133") ? ["Stryker was here"] : (stryCov_9fa48("1133"), []);
  private phase: "collecting" | "finished" = stryMutAct_9fa48("1134") ? "" : (stryCov_9fa48("1134"), "collecting");
  private receivedBytes = 0;
  private consumedBytes = 0;
  private rootComplete = stryMutAct_9fa48("1135") ? true : (stryCov_9fa48("1135"), false);
  private terminal = stryMutAct_9fa48("1136") ? true : (stryCov_9fa48("1136"), false);
  private hasSeenValue = stryMutAct_9fa48("1137") ? true : (stryCov_9fa48("1137"), false);
  private syntax_: SyntaxStatus = stryMutAct_9fa48("1138") ? "" : (stryCov_9fa48("1138"), "empty");
  private trailingDataSeen = stryMutAct_9fa48("1139") ? true : (stryCov_9fa48("1139"), false);
  private trailingDataBytes = 0;
  private rootScalarValue: JsonValue | undefined = undefined;
  private readonly repairs: RepairOptions;

  // Track if we're in a duplicate-key value (to skip it)
  private skipValueDepth = 0;
  private isSkippingValue = stryMutAct_9fa48("1140") ? true : (stryCov_9fa48("1140"), false);

  // For finish
  private finishMeta: {
    reason?: StreamEndReason;
    providerReason?: string;
  } | undefined;
  constructor(options?: ParserOptions) {
    if (stryMutAct_9fa48("1141")) {
      {}
    } else {
      stryCov_9fa48("1141");
      const userLimits = stryMutAct_9fa48("1142") ? options?.limits && {} : (stryCov_9fa48("1142"), (stryMutAct_9fa48("1143") ? options.limits : (stryCov_9fa48("1143"), options?.limits)) ?? {});
      this.limits = stryMutAct_9fa48("1144") ? {} : (stryCov_9fa48("1144"), {
        maxInputBytes: stryMutAct_9fa48("1145") ? userLimits.maxInputBytes && DEFAULT_LIMITS.maxInputBytes : (stryCov_9fa48("1145"), userLimits.maxInputBytes ?? DEFAULT_LIMITS.maxInputBytes),
        maxDepth: stryMutAct_9fa48("1146") ? userLimits.maxDepth && DEFAULT_LIMITS.maxDepth : (stryCov_9fa48("1146"), userLimits.maxDepth ?? DEFAULT_LIMITS.maxDepth),
        maxStringBytes: stryMutAct_9fa48("1147") ? userLimits.maxStringBytes && DEFAULT_LIMITS.maxStringBytes : (stryCov_9fa48("1147"), userLimits.maxStringBytes ?? DEFAULT_LIMITS.maxStringBytes),
        maxQueuedEvents: stryMutAct_9fa48("1148") ? userLimits.maxQueuedEvents && DEFAULT_LIMITS.maxQueuedEvents : (stryCov_9fa48("1148"), userLimits.maxQueuedEvents ?? DEFAULT_LIMITS.maxQueuedEvents),
        maxTrailingDataBytes: stryMutAct_9fa48("1149") ? userLimits.maxTrailingDataBytes && DEFAULT_LIMITS.maxTrailingDataBytes : (stryCov_9fa48("1149"), userLimits.maxTrailingDataBytes ?? DEFAULT_LIMITS.maxTrailingDataBytes)
      });
      this.repairs = stryMutAct_9fa48("1150") ? {} : (stryCov_9fa48("1150"), {
        rawControlCharacters: stryMutAct_9fa48("1151") ? options?.repairs?.rawControlCharacters && "reject" : (stryCov_9fa48("1151"), (stryMutAct_9fa48("1153") ? options.repairs?.rawControlCharacters : stryMutAct_9fa48("1152") ? options?.repairs.rawControlCharacters : (stryCov_9fa48("1152", "1153"), options?.repairs?.rawControlCharacters)) ?? (stryMutAct_9fa48("1154") ? "" : (stryCov_9fa48("1154"), "reject"))),
        trailingData: stryMutAct_9fa48("1155") ? options?.repairs?.trailingData && "isolate" : (stryCov_9fa48("1155"), (stryMutAct_9fa48("1157") ? options.repairs?.trailingData : stryMutAct_9fa48("1156") ? options?.repairs.trailingData : (stryCov_9fa48("1156", "1157"), options?.repairs?.trailingData)) ?? (stryMutAct_9fa48("1158") ? "" : (stryCov_9fa48("1158"), "isolate"))),
        closeContainersAtFinish: stryMutAct_9fa48("1159") ? options?.repairs?.closeContainersAtFinish && "disabled" : (stryCov_9fa48("1159"), (stryMutAct_9fa48("1161") ? options.repairs?.closeContainersAtFinish : stryMutAct_9fa48("1160") ? options?.repairs.closeContainersAtFinish : (stryCov_9fa48("1160", "1161"), options?.repairs?.closeContainersAtFinish)) ?? (stryMutAct_9fa48("1162") ? "" : (stryCov_9fa48("1162"), "disabled")))
      });
      this.utf8 = new Utf8Decoder();
      this.scanner = new Scanner(options);
      this.grammar = new GrammarStack(this.limits.maxDepth);
      this.events = new EventBuilder(this.limits.maxQueuedEvents);
      this.snapshot_ = new SnapshotBuilder();
    }
  }
  push(chunk: string | Uint8Array): PushResult {
    if (stryMutAct_9fa48("1163")) {
      {}
    } else {
      stryCov_9fa48("1163");
      if (stryMutAct_9fa48("1166") ? this.phase !== "finished" : stryMutAct_9fa48("1165") ? false : stryMutAct_9fa48("1164") ? true : (stryCov_9fa48("1164", "1165", "1166"), this.phase === (stryMutAct_9fa48("1167") ? "" : (stryCov_9fa48("1167"), "finished")))) {
        if (stryMutAct_9fa48("1168")) {
          {}
        } else {
          stryCov_9fa48("1168");
          throw new Error(stryMutAct_9fa48("1169") ? "" : (stryCov_9fa48("1169"), "E_PUSH_AFTER_FINISH: push() called after finish()"));
        }
      }
      if (stryMutAct_9fa48("1171") ? false : stryMutAct_9fa48("1170") ? true : (stryCov_9fa48("1170", "1171"), this.terminal)) {
        if (stryMutAct_9fa48("1172")) {
          {}
        } else {
          stryCov_9fa48("1172");
          return stryMutAct_9fa48("1173") ? {} : (stryCov_9fa48("1173"), {
            acceptedBytes: 0,
            emittedEvents: 0,
            syntax: this.syntax_,
            terminal: stryMutAct_9fa48("1174") ? false : (stryCov_9fa48("1174"), true)
          });
        }
      }

      // Convert string to bytes
      const bytes = (stryMutAct_9fa48("1177") ? typeof chunk !== "string" : stryMutAct_9fa48("1176") ? false : stryMutAct_9fa48("1175") ? true : (stryCov_9fa48("1175", "1176", "1177"), typeof chunk === (stryMutAct_9fa48("1178") ? "" : (stryCov_9fa48("1178"), "string")))) ? stringToUtf8(chunk) : chunk;

      // Check input limit
      if (stryMutAct_9fa48("1182") ? this.receivedBytes + bytes.length <= this.limits.maxInputBytes : stryMutAct_9fa48("1181") ? this.receivedBytes + bytes.length >= this.limits.maxInputBytes : stryMutAct_9fa48("1180") ? false : stryMutAct_9fa48("1179") ? true : (stryCov_9fa48("1179", "1180", "1181", "1182"), (stryMutAct_9fa48("1183") ? this.receivedBytes - bytes.length : (stryCov_9fa48("1183"), this.receivedBytes + bytes.length)) > this.limits.maxInputBytes)) {
        if (stryMutAct_9fa48("1184")) {
          {}
        } else {
          stryCov_9fa48("1184");
          const diag = createDiagnostic(DiagnosticCode.E_LIMIT_INPUT_BYTES, stryMutAct_9fa48("1185") ? "" : (stryCov_9fa48("1185"), "fatal"), this.receivedBytes, stryMutAct_9fa48("1186") ? `` : (stryCov_9fa48("1186"), `Input exceeds maximum of ${this.limits.maxInputBytes} bytes`), stryMutAct_9fa48("1187") ? true : (stryCov_9fa48("1187"), false));
          this.addDiagnostic(diag);
          this.terminal = stryMutAct_9fa48("1188") ? false : (stryCov_9fa48("1188"), true);
          this.syntax_ = stryMutAct_9fa48("1189") ? "" : (stryCov_9fa48("1189"), "invalid");
          return stryMutAct_9fa48("1190") ? {} : (stryCov_9fa48("1190"), {
            acceptedBytes: 0,
            emittedEvents: 0,
            syntax: this.syntax_,
            terminal: stryMutAct_9fa48("1191") ? false : (stryCov_9fa48("1191"), true)
          });
        }
      }
      stryMutAct_9fa48("1192") ? this.receivedBytes -= bytes.length : (stryCov_9fa48("1192"), this.receivedBytes += bytes.length);
      this.events.resetPushCount();

      // Decode UTF-8
      const decoded = this.utf8.decode(bytes);
      if (stryMutAct_9fa48("1194") ? false : stryMutAct_9fa48("1193") ? true : (stryCov_9fa48("1193", "1194"), decoded.strippedBom)) {
        if (stryMutAct_9fa48("1195")) {
          {}
        } else {
          stryCov_9fa48("1195");
          const repair: RepairAction = stryMutAct_9fa48("1196") ? {} : (stryCov_9fa48("1196"), {
            code: stryMutAct_9fa48("1197") ? "" : (stryCov_9fa48("1197"), "R_STRIP_UTF8_BOM"),
            byteRange: stryMutAct_9fa48("1198") ? [] : (stryCov_9fa48("1198"), [0, 3]),
            impact: stryMutAct_9fa48("1199") ? "" : (stryCov_9fa48("1199"), "representation_preserving"),
            description: stryMutAct_9fa48("1200") ? "" : (stryCov_9fa48("1200"), "Stripped UTF-8 BOM at index 0")
          });
          this.allRepairs.push(repair);
          this.events.emitRepairApplied(repair);
        }
      }

      // Handle UTF-8 errors
      for (const err of decoded.errors) {
        if (stryMutAct_9fa48("1201")) {
          {}
        } else {
          stryCov_9fa48("1201");
          const code = (stryMutAct_9fa48("1204") ? err.kind !== "overlong" : stryMutAct_9fa48("1203") ? false : stryMutAct_9fa48("1202") ? true : (stryCov_9fa48("1202", "1203", "1204"), err.kind === (stryMutAct_9fa48("1205") ? "" : (stryCov_9fa48("1205"), "overlong")))) ? DiagnosticCode.E_INVALID_UTF8 : (stryMutAct_9fa48("1208") ? err.kind !== "out_of_range" : stryMutAct_9fa48("1207") ? false : stryMutAct_9fa48("1206") ? true : (stryCov_9fa48("1206", "1207", "1208"), err.kind === (stryMutAct_9fa48("1209") ? "" : (stryCov_9fa48("1209"), "out_of_range")))) ? DiagnosticCode.E_INVALID_UTF8 : (stryMutAct_9fa48("1212") ? err.kind !== "invalid_start_byte" : stryMutAct_9fa48("1211") ? false : stryMutAct_9fa48("1210") ? true : (stryCov_9fa48("1210", "1211", "1212"), err.kind === (stryMutAct_9fa48("1213") ? "" : (stryCov_9fa48("1213"), "invalid_start_byte")))) ? DiagnosticCode.E_INVALID_UTF8 : DiagnosticCode.E_INVALID_UTF8;
          const diag = createDiagnostic(code, stryMutAct_9fa48("1214") ? "" : (stryCov_9fa48("1214"), "error"), err.byteOffset, stryMutAct_9fa48("1215") ? `` : (stryCov_9fa48("1215"), `Invalid UTF-8: ${err.kind} at byte ${err.byteOffset}`), stryMutAct_9fa48("1216") ? true : (stryCov_9fa48("1216"), false));
          this.addDiagnostic(diag);
          this.syntax_ = stryMutAct_9fa48("1217") ? "" : (stryCov_9fa48("1217"), "invalid");
          this.terminal = stryMutAct_9fa48("1218") ? false : (stryCov_9fa48("1218"), true);
          return stryMutAct_9fa48("1219") ? {} : (stryCov_9fa48("1219"), {
            acceptedBytes: decoded.consumed,
            emittedEvents: this.events.emittedDuringPush,
            syntax: this.syntax_,
            terminal: stryMutAct_9fa48("1220") ? false : (stryCov_9fa48("1220"), true)
          });
        }
      }

      // Feed decoded text to scanner character by character
      const text = decoded.text;
      // Track byte positions via UTF-8 encoding
      let bytePos = this.consumedBytes;
      for (const ch of text) {
        if (stryMutAct_9fa48("1221")) {
          {}
        } else {
          stryCov_9fa48("1221");
          if (stryMutAct_9fa48("1223") ? false : stryMutAct_9fa48("1222") ? true : (stryCov_9fa48("1222", "1223"), this.terminal)) break;
          const charBytes = getUtf8ByteLength(ch);

          // If root is already complete, handle trailing content at parser level
          if (stryMutAct_9fa48("1225") ? false : stryMutAct_9fa48("1224") ? true : (stryCov_9fa48("1224", "1225"), this.rootComplete)) {
            if (stryMutAct_9fa48("1226")) {
              {}
            } else {
              stryCov_9fa48("1226");
              const isWs = stryMutAct_9fa48("1229") ? (ch === " " || ch === "\t" || ch === "\n") && ch === "\r" : stryMutAct_9fa48("1228") ? false : stryMutAct_9fa48("1227") ? true : (stryCov_9fa48("1227", "1228", "1229"), (stryMutAct_9fa48("1231") ? (ch === " " || ch === "\t") && ch === "\n" : stryMutAct_9fa48("1230") ? false : (stryCov_9fa48("1230", "1231"), (stryMutAct_9fa48("1233") ? ch === " " && ch === "\t" : stryMutAct_9fa48("1232") ? false : (stryCov_9fa48("1232", "1233"), (stryMutAct_9fa48("1235") ? ch !== " " : stryMutAct_9fa48("1234") ? false : (stryCov_9fa48("1234", "1235"), ch === (stryMutAct_9fa48("1236") ? "" : (stryCov_9fa48("1236"), " ")))) || (stryMutAct_9fa48("1238") ? ch !== "\t" : stryMutAct_9fa48("1237") ? false : (stryCov_9fa48("1237", "1238"), ch === (stryMutAct_9fa48("1239") ? "" : (stryCov_9fa48("1239"), "\t")))))) || (stryMutAct_9fa48("1241") ? ch !== "\n" : stryMutAct_9fa48("1240") ? false : (stryCov_9fa48("1240", "1241"), ch === (stryMutAct_9fa48("1242") ? "" : (stryCov_9fa48("1242"), "\n")))))) || (stryMutAct_9fa48("1244") ? ch !== "\r" : stryMutAct_9fa48("1243") ? false : (stryCov_9fa48("1243", "1244"), ch === (stryMutAct_9fa48("1245") ? "" : (stryCov_9fa48("1245"), "\r")))));
              if (stryMutAct_9fa48("1248") ? false : stryMutAct_9fa48("1247") ? true : stryMutAct_9fa48("1246") ? isWs : (stryCov_9fa48("1246", "1247", "1248"), !isWs)) {
                if (stryMutAct_9fa48("1249")) {
                  {}
                } else {
                  stryCov_9fa48("1249");
                  if (stryMutAct_9fa48("1252") ? false : stryMutAct_9fa48("1251") ? true : stryMutAct_9fa48("1250") ? this.trailingDataSeen : (stryCov_9fa48("1250", "1251", "1252"), !this.trailingDataSeen)) {
                    if (stryMutAct_9fa48("1253")) {
                      {}
                    } else {
                      stryCov_9fa48("1253");
                      this.trailingDataSeen = stryMutAct_9fa48("1254") ? false : (stryCov_9fa48("1254"), true);
                      if (stryMutAct_9fa48("1257") ? this.repairs.trailingData !== "reject" : stryMutAct_9fa48("1256") ? false : stryMutAct_9fa48("1255") ? true : (stryCov_9fa48("1255", "1256", "1257"), this.repairs.trailingData === (stryMutAct_9fa48("1258") ? "" : (stryCov_9fa48("1258"), "reject")))) {
                        if (stryMutAct_9fa48("1259")) {
                          {}
                        } else {
                          stryCov_9fa48("1259");
                          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_TRAILING_DATA, stryMutAct_9fa48("1260") ? "" : (stryCov_9fa48("1260"), "error"), bytePos, stryMutAct_9fa48("1261") ? `` : (stryCov_9fa48("1261"), `Trailing data rejected`), stryMutAct_9fa48("1262") ? true : (stryCov_9fa48("1262"), false)));
                          this.syntax_ = stryMutAct_9fa48("1263") ? "" : (stryCov_9fa48("1263"), "invalid");
                          this.terminal = stryMutAct_9fa48("1264") ? false : (stryCov_9fa48("1264"), true);
                          return stryMutAct_9fa48("1265") ? {} : (stryCov_9fa48("1265"), {
                            acceptedBytes: decoded.consumed,
                            emittedEvents: this.events.emittedDuringPush,
                            syntax: this.syntax_,
                            terminal: stryMutAct_9fa48("1266") ? false : (stryCov_9fa48("1266"), true)
                          });
                        }
                      }
                      this.addDiagnostic(createDiagnostic(DiagnosticCode.E_TRAILING_DATA, stryMutAct_9fa48("1267") ? "" : (stryCov_9fa48("1267"), "warning"), bytePos, stryMutAct_9fa48("1268") ? `` : (stryCov_9fa48("1268"), `Unexpected data after root JSON value`), stryMutAct_9fa48("1269") ? false : (stryCov_9fa48("1269"), true)));
                      const repair: RepairAction = stryMutAct_9fa48("1270") ? {} : (stryCov_9fa48("1270"), {
                        code: stryMutAct_9fa48("1271") ? "" : (stryCov_9fa48("1271"), "R_ISOLATE_TRAILING_DATA"),
                        byteRange: stryMutAct_9fa48("1272") ? [] : (stryCov_9fa48("1272"), [bytePos, stryMutAct_9fa48("1273") ? bytePos - charBytes : (stryCov_9fa48("1273"), bytePos + charBytes)]),
                        impact: stryMutAct_9fa48("1274") ? "" : (stryCov_9fa48("1274"), "root_preserving"),
                        description: stryMutAct_9fa48("1275") ? "" : (stryCov_9fa48("1275"), "Isolated trailing data after complete JSON root")
                      });
                      this.allRepairs.push(repair);
                      this.events.emitRepairApplied(repair);
                    }
                  }
                  stryMutAct_9fa48("1276") ? this.trailingDataBytes -= charBytes : (stryCov_9fa48("1276"), this.trailingDataBytes += charBytes);
                  if (stryMutAct_9fa48("1280") ? this.trailingDataBytes <= this.limits.maxTrailingDataBytes : stryMutAct_9fa48("1279") ? this.trailingDataBytes >= this.limits.maxTrailingDataBytes : stryMutAct_9fa48("1278") ? false : stryMutAct_9fa48("1277") ? true : (stryCov_9fa48("1277", "1278", "1279", "1280"), this.trailingDataBytes > this.limits.maxTrailingDataBytes)) {
                    if (stryMutAct_9fa48("1281")) {
                      {}
                    } else {
                      stryCov_9fa48("1281");
                      this.addDiagnostic(createDiagnostic(DiagnosticCode.E_LIMIT_INPUT_BYTES, stryMutAct_9fa48("1282") ? "" : (stryCov_9fa48("1282"), "error"), bytePos, stryMutAct_9fa48("1283") ? `` : (stryCov_9fa48("1283"), `Maximum trailing data bytes exceeded`), stryMutAct_9fa48("1284") ? true : (stryCov_9fa48("1284"), false)));
                      this.syntax_ = stryMutAct_9fa48("1285") ? "" : (stryCov_9fa48("1285"), "invalid");
                      this.terminal = stryMutAct_9fa48("1286") ? false : (stryCov_9fa48("1286"), true);
                    }
                  }
                }
              }
              stryMutAct_9fa48("1287") ? bytePos -= charBytes : (stryCov_9fa48("1287"), bytePos += charBytes);
              continue;
            }
          }

          // Set up scanner for object key context
          const frame = this.grammar.current;
          if (stryMutAct_9fa48("1290") ? frame && frame.containerType === "object" && (frame.objectExpectation === "first_key_or_end" || frame.objectExpectation === "key_after_comma") || this.scanner.currentState === ScannerState.Structural : stryMutAct_9fa48("1289") ? false : stryMutAct_9fa48("1288") ? true : (stryCov_9fa48("1288", "1289", "1290"), (stryMutAct_9fa48("1292") ? frame && frame.containerType === "object" || frame.objectExpectation === "first_key_or_end" || frame.objectExpectation === "key_after_comma" : stryMutAct_9fa48("1291") ? true : (stryCov_9fa48("1291", "1292"), (stryMutAct_9fa48("1294") ? frame || frame.containerType === "object" : stryMutAct_9fa48("1293") ? true : (stryCov_9fa48("1293", "1294"), frame && (stryMutAct_9fa48("1296") ? frame.containerType !== "object" : stryMutAct_9fa48("1295") ? true : (stryCov_9fa48("1295", "1296"), frame.containerType === (stryMutAct_9fa48("1297") ? "" : (stryCov_9fa48("1297"), "object")))))) && (stryMutAct_9fa48("1299") ? frame.objectExpectation === "first_key_or_end" && frame.objectExpectation === "key_after_comma" : stryMutAct_9fa48("1298") ? true : (stryCov_9fa48("1298", "1299"), (stryMutAct_9fa48("1301") ? frame.objectExpectation !== "first_key_or_end" : stryMutAct_9fa48("1300") ? false : (stryCov_9fa48("1300", "1301"), frame.objectExpectation === (stryMutAct_9fa48("1302") ? "" : (stryCov_9fa48("1302"), "first_key_or_end")))) || (stryMutAct_9fa48("1304") ? frame.objectExpectation !== "key_after_comma" : stryMutAct_9fa48("1303") ? false : (stryCov_9fa48("1303", "1304"), frame.objectExpectation === (stryMutAct_9fa48("1305") ? "" : (stryCov_9fa48("1305"), "key_after_comma")))))))) && (stryMutAct_9fa48("1307") ? this.scanner.currentState !== ScannerState.Structural : stryMutAct_9fa48("1306") ? true : (stryCov_9fa48("1306", "1307"), this.scanner.currentState === ScannerState.Structural)))) {
            if (stryMutAct_9fa48("1308")) {
              {}
            } else {
              stryCov_9fa48("1308");
              this.scanner.setNextStringIsKey(stryMutAct_9fa48("1309") ? false : (stryCov_9fa48("1309"), true));
            }
          }
          this.scanner.feedChar(ch, bytePos, charBytes);

          // Process any emitted tokens
          const tokens = this.scanner.takeTokens();
          for (const token of tokens) {
            if (stryMutAct_9fa48("1310")) {
              {}
            } else {
              stryCov_9fa48("1310");
              if (stryMutAct_9fa48("1312") ? false : stryMutAct_9fa48("1311") ? true : (stryCov_9fa48("1311", "1312"), this.terminal)) break;
              this.processToken(token);
            }
          }

          // Process any scanner diagnostics and repairs
          const scanDiags = this.scanner.takeDiagnostics();
          const scanRepairs = this.scanner.takeRepairs();
          for (const repair of scanRepairs) {
            if (stryMutAct_9fa48("1313")) {
              {}
            } else {
              stryCov_9fa48("1313");
              this.allRepairs.push(repair);
              this.events.emitRepairApplied(repair);
            }
          }
          for (const diag of scanDiags) {
            if (stryMutAct_9fa48("1314")) {
              {}
            } else {
              stryCov_9fa48("1314");
              this.addDiagnostic(diag);
              if (stryMutAct_9fa48("1317") ? diag.severity === "fatal" && diag.severity === "error" && !diag.recoverable : stryMutAct_9fa48("1316") ? false : stryMutAct_9fa48("1315") ? true : (stryCov_9fa48("1315", "1316", "1317"), (stryMutAct_9fa48("1319") ? diag.severity !== "fatal" : stryMutAct_9fa48("1318") ? false : (stryCov_9fa48("1318", "1319"), diag.severity === (stryMutAct_9fa48("1320") ? "" : (stryCov_9fa48("1320"), "fatal")))) || (stryMutAct_9fa48("1322") ? diag.severity === "error" || !diag.recoverable : stryMutAct_9fa48("1321") ? false : (stryCov_9fa48("1321", "1322"), (stryMutAct_9fa48("1324") ? diag.severity !== "error" : stryMutAct_9fa48("1323") ? true : (stryCov_9fa48("1323", "1324"), diag.severity === (stryMutAct_9fa48("1325") ? "" : (stryCov_9fa48("1325"), "error")))) && (stryMutAct_9fa48("1326") ? diag.recoverable : (stryCov_9fa48("1326"), !diag.recoverable)))))) {
                if (stryMutAct_9fa48("1327")) {
                  {}
                } else {
                  stryCov_9fa48("1327");
                  this.syntax_ = stryMutAct_9fa48("1328") ? "" : (stryCov_9fa48("1328"), "invalid");
                  this.terminal = stryMutAct_9fa48("1329") ? false : (stryCov_9fa48("1329"), true);
                }
              }
            }
          }

          // After processing tokens, check if rootComplete was just set
          // and handle trailing data detection
          if (stryMutAct_9fa48("1332") ? this.rootComplete || !this.trailingDataSeen : stryMutAct_9fa48("1331") ? false : stryMutAct_9fa48("1330") ? true : (stryCov_9fa48("1330", "1331", "1332"), this.rootComplete && (stryMutAct_9fa48("1333") ? this.trailingDataSeen : (stryCov_9fa48("1333"), !this.trailingDataSeen)))) {
            // The scanner may still be in Structural state after root close.
            // We don't need to do anything here — the scanner's processStructural
            // will handle further characters. But we need the scanner to know
            // it should be in trailing whitespace mode.
            // Actually, the scanner doesn't manage this for container closes.
            // We'll detect trailing data in subsequent characters.
          }

          // Process grammar diagnostics
          const grammarDiags = this.grammar.takeDiagnostics();
          for (const diag of grammarDiags) {
            if (stryMutAct_9fa48("1334")) {
              {}
            } else {
              stryCov_9fa48("1334");
              this.addDiagnostic(diag);
              if (stryMutAct_9fa48("1337") ? diag.severity !== "fatal" : stryMutAct_9fa48("1336") ? false : stryMutAct_9fa48("1335") ? true : (stryCov_9fa48("1335", "1336", "1337"), diag.severity === (stryMutAct_9fa48("1338") ? "" : (stryCov_9fa48("1338"), "fatal")))) {
                if (stryMutAct_9fa48("1339")) {
                  {}
                } else {
                  stryCov_9fa48("1339");
                  this.terminal = stryMutAct_9fa48("1340") ? false : (stryCov_9fa48("1340"), true);
                  this.syntax_ = stryMutAct_9fa48("1341") ? "" : (stryCov_9fa48("1341"), "invalid");
                }
              }
            }
          }
          if (stryMutAct_9fa48("1343") ? false : stryMutAct_9fa48("1342") ? true : (stryCov_9fa48("1342", "1343"), this.events.isTerminal)) {
            if (stryMutAct_9fa48("1344")) {
              {}
            } else {
              stryCov_9fa48("1344");
              this.terminal = stryMutAct_9fa48("1345") ? false : (stryCov_9fa48("1345"), true);
              this.syntax_ = stryMutAct_9fa48("1346") ? "" : (stryCov_9fa48("1346"), "invalid");
              break;
            }
          }
          stryMutAct_9fa48("1347") ? bytePos -= charBytes : (stryCov_9fa48("1347"), bytePos += charBytes);
        }
      }
      this.consumedBytes = bytePos;
      return stryMutAct_9fa48("1348") ? {} : (stryCov_9fa48("1348"), {
        acceptedBytes: decoded.consumed,
        emittedEvents: this.events.emittedDuringPush,
        syntax: this.syntax_,
        terminal: this.terminal
      });
    }
  }
  snapshot(): ParserSnapshot {
    if (stryMutAct_9fa48("1349")) {
      {}
    } else {
      stryCov_9fa48("1349");
      const pending = this.buildPendingTokens();
      return stryMutAct_9fa48("1350") ? {} : (stryCov_9fa48("1350"), {
        phase: this.phase,
        syntax: this.syntax_,
        stableValue: this.buildStableValue(),
        rootComplete: this.rootComplete,
        executable: this.isExecutable(),
        pending,
        repairs: Object.freeze(stryMutAct_9fa48("1351") ? [] : (stryCov_9fa48("1351"), [...this.allRepairs])),
        diagnostics: Object.freeze(stryMutAct_9fa48("1352") ? [] : (stryCov_9fa48("1352"), [...this.allDiagnostics])),
        receivedBytes: this.receivedBytes,
        consumedBytes: this.consumedBytes
      });
    }
  }
  drainEvents(): readonly ParserEvent[] {
    if (stryMutAct_9fa48("1353")) {
      {}
    } else {
      stryCov_9fa48("1353");
      return this.events.drain();
    }
  }
  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): FinalResult {
    if (stryMutAct_9fa48("1354")) {
      {}
    } else {
      stryCov_9fa48("1354");
      if (stryMutAct_9fa48("1357") ? this.phase !== "finished" : stryMutAct_9fa48("1356") ? false : stryMutAct_9fa48("1355") ? true : (stryCov_9fa48("1355", "1356", "1357"), this.phase === (stryMutAct_9fa48("1358") ? "" : (stryCov_9fa48("1358"), "finished")))) {
        if (stryMutAct_9fa48("1359")) {
          {}
        } else {
          stryCov_9fa48("1359");
          throw new Error(stryMutAct_9fa48("1360") ? "" : (stryCov_9fa48("1360"), "E_PUSH_AFTER_FINISH: finish() called more than once"));
        }
      }
      this.phase = stryMutAct_9fa48("1361") ? "" : (stryCov_9fa48("1361"), "finished");
      this.finishMeta = meta;
      const reason = stryMutAct_9fa48("1362") ? meta?.reason && "unknown" : (stryCov_9fa48("1362"), (stryMutAct_9fa48("1363") ? meta.reason : (stryCov_9fa48("1363"), meta?.reason)) ?? (stryMutAct_9fa48("1364") ? "" : (stryCov_9fa48("1364"), "unknown")));

      // Try to finalize any pending number or literal at stream end
      if (stryMutAct_9fa48("1367") ? false : stryMutAct_9fa48("1366") ? true : stryMutAct_9fa48("1365") ? this.terminal : (stryCov_9fa48("1365", "1366", "1367"), !this.terminal)) {
        if (stryMutAct_9fa48("1368")) {
          {}
        } else {
          stryCov_9fa48("1368");
          // Check for pending number — at stream end, numbers can be finalized
          // only if the stream completed normally
          const pendingInfo = this.scanner.getPendingInfo();
          if (stryMutAct_9fa48("1371") ? pendingInfo.type !== "number" : stryMutAct_9fa48("1370") ? false : stryMutAct_9fa48("1369") ? true : (stryCov_9fa48("1369", "1370", "1371"), pendingInfo.type === (stryMutAct_9fa48("1372") ? "" : (stryCov_9fa48("1372"), "number")))) {
            if (stryMutAct_9fa48("1373")) {
              {}
            } else {
              stryCov_9fa48("1373");
              if (stryMutAct_9fa48("1376") ? reason !== "complete" : stryMutAct_9fa48("1375") ? false : stryMutAct_9fa48("1374") ? true : (stryCov_9fa48("1374", "1375", "1376"), reason === (stryMutAct_9fa48("1377") ? "" : (stryCov_9fa48("1377"), "complete")))) {
                if (stryMutAct_9fa48("1378")) {
                  {}
                } else {
                  stryCov_9fa48("1378");
                  // Stream ended normally — the number terminator is implicit EOF
                  const finalized = this.scanner.finalizeNumber();
                  if (stryMutAct_9fa48("1380") ? false : stryMutAct_9fa48("1379") ? true : (stryCov_9fa48("1379", "1380"), finalized)) {
                    if (stryMutAct_9fa48("1381")) {
                      {}
                    } else {
                      stryCov_9fa48("1381");
                      const tokens = this.scanner.takeTokens();
                      for (const token of tokens) {
                        if (stryMutAct_9fa48("1382")) {
                          {}
                        } else {
                          stryCov_9fa48("1382");
                          this.processToken(token);
                        }
                      }
                    }
                  }
                }
              } else {
                if (stryMutAct_9fa48("1383")) {
                  {}
                } else {
                  stryCov_9fa48("1383");
                  // Truncated — number is incomplete
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_INCOMPLETE_NUMBER, stryMutAct_9fa48("1384") ? "" : (stryCov_9fa48("1384"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1385") ? `` : (stryCov_9fa48("1385"), `Incomplete number at stream end: ${pendingInfo.buffer}`), stryMutAct_9fa48("1386") ? true : (stryCov_9fa48("1386"), false)));
                }
              }
            }
          } else if (stryMutAct_9fa48("1389") ? pendingInfo.type !== "literal" : stryMutAct_9fa48("1388") ? false : stryMutAct_9fa48("1387") ? true : (stryCov_9fa48("1387", "1388", "1389"), pendingInfo.type === (stryMutAct_9fa48("1390") ? "" : (stryCov_9fa48("1390"), "literal")))) {
            if (stryMutAct_9fa48("1391")) {
              {}
            } else {
              stryCov_9fa48("1391");
              if (stryMutAct_9fa48("1394") ? reason === "complete" || pendingInfo.buffer.length === (pendingInfo.buffer === "tru" || pendingInfo.buffer === "fal" ? 0 : pendingInfo.buffer.length) : stryMutAct_9fa48("1393") ? false : stryMutAct_9fa48("1392") ? true : (stryCov_9fa48("1392", "1393", "1394"), (stryMutAct_9fa48("1396") ? reason !== "complete" : stryMutAct_9fa48("1395") ? true : (stryCov_9fa48("1395", "1396"), reason === (stryMutAct_9fa48("1397") ? "" : (stryCov_9fa48("1397"), "complete")))) && (stryMutAct_9fa48("1399") ? pendingInfo.buffer.length !== (pendingInfo.buffer === "tru" || pendingInfo.buffer === "fal" ? 0 : pendingInfo.buffer.length) : stryMutAct_9fa48("1398") ? true : (stryCov_9fa48("1398", "1399"), pendingInfo.buffer.length === ((stryMutAct_9fa48("1402") ? pendingInfo.buffer === "tru" && pendingInfo.buffer === "fal" : stryMutAct_9fa48("1401") ? false : stryMutAct_9fa48("1400") ? true : (stryCov_9fa48("1400", "1401", "1402"), (stryMutAct_9fa48("1404") ? pendingInfo.buffer !== "tru" : stryMutAct_9fa48("1403") ? false : (stryCov_9fa48("1403", "1404"), pendingInfo.buffer === (stryMutAct_9fa48("1405") ? "" : (stryCov_9fa48("1405"), "tru")))) || (stryMutAct_9fa48("1407") ? pendingInfo.buffer !== "fal" : stryMutAct_9fa48("1406") ? false : (stryCov_9fa48("1406", "1407"), pendingInfo.buffer === (stryMutAct_9fa48("1408") ? "" : (stryCov_9fa48("1408"), "fal")))))) ? 0 : pendingInfo.buffer.length))))) {
                if (stryMutAct_9fa48("1409")) {
                  {}
                } else {
                  stryCov_9fa48("1409");
                  const finalized = this.scanner.finalizeLiteral();
                  if (stryMutAct_9fa48("1411") ? false : stryMutAct_9fa48("1410") ? true : (stryCov_9fa48("1410", "1411"), finalized)) {
                    if (stryMutAct_9fa48("1412")) {
                      {}
                    } else {
                      stryCov_9fa48("1412");
                      const tokens = this.scanner.takeTokens();
                      for (const token of tokens) {
                        if (stryMutAct_9fa48("1413")) {
                          {}
                        } else {
                          stryCov_9fa48("1413");
                          this.processToken(token);
                        }
                      }
                    }
                  } else {
                    if (stryMutAct_9fa48("1414")) {
                      {}
                    } else {
                      stryCov_9fa48("1414");
                      this.addDiagnostic(createDiagnostic(DiagnosticCode.E_INCOMPLETE_LITERAL, stryMutAct_9fa48("1415") ? "" : (stryCov_9fa48("1415"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1416") ? `` : (stryCov_9fa48("1416"), `Incomplete literal at stream end: ${pendingInfo.buffer}`), stryMutAct_9fa48("1417") ? true : (stryCov_9fa48("1417"), false)));
                    }
                  }
                }
              } else {
                if (stryMutAct_9fa48("1418")) {
                  {}
                } else {
                  stryCov_9fa48("1418");
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_INCOMPLETE_LITERAL, stryMutAct_9fa48("1419") ? "" : (stryCov_9fa48("1419"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1420") ? `` : (stryCov_9fa48("1420"), `Incomplete literal at stream end: ${pendingInfo.buffer}`), stryMutAct_9fa48("1421") ? true : (stryCov_9fa48("1421"), false)));
                }
              }
            }
          } else if (stryMutAct_9fa48("1424") ? pendingInfo.type === "string" && pendingInfo.type === "object_key" as string : stryMutAct_9fa48("1423") ? false : stryMutAct_9fa48("1422") ? true : (stryCov_9fa48("1422", "1423", "1424"), (stryMutAct_9fa48("1426") ? pendingInfo.type !== "string" : stryMutAct_9fa48("1425") ? false : (stryCov_9fa48("1425", "1426"), pendingInfo.type === (stryMutAct_9fa48("1427") ? "" : (stryCov_9fa48("1427"), "string")))) || (stryMutAct_9fa48("1429") ? pendingInfo.type !== "object_key" as string : stryMutAct_9fa48("1428") ? false : (stryCov_9fa48("1428", "1429"), pendingInfo.type === "object_key" as string)))) {
            if (stryMutAct_9fa48("1430")) {
              {}
            } else {
              stryCov_9fa48("1430");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNTERMINATED_STRING, stryMutAct_9fa48("1431") ? "" : (stryCov_9fa48("1431"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1432") ? "" : (stryCov_9fa48("1432"), "Unterminated string at stream end"), stryMutAct_9fa48("1433") ? true : (stryCov_9fa48("1433"), false)));
            }
          } else if (stryMutAct_9fa48("1436") ? pendingInfo.type !== "unicode_escape" : stryMutAct_9fa48("1435") ? false : stryMutAct_9fa48("1434") ? true : (stryCov_9fa48("1434", "1435", "1436"), pendingInfo.type === (stryMutAct_9fa48("1437") ? "" : (stryCov_9fa48("1437"), "unicode_escape")))) {
            if (stryMutAct_9fa48("1438")) {
              {}
            } else {
              stryCov_9fa48("1438");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_INCOMPLETE_UNICODE_ESCAPE, stryMutAct_9fa48("1439") ? "" : (stryCov_9fa48("1439"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1440") ? "" : (stryCov_9fa48("1440"), "Incomplete unicode escape at stream end"), stryMutAct_9fa48("1441") ? true : (stryCov_9fa48("1441"), false)));
            }
          } else if (stryMutAct_9fa48("1444") ? pendingInfo.type !== "surrogate" : stryMutAct_9fa48("1443") ? false : stryMutAct_9fa48("1442") ? true : (stryCov_9fa48("1442", "1443", "1444"), pendingInfo.type === (stryMutAct_9fa48("1445") ? "" : (stryCov_9fa48("1445"), "surrogate")))) {
            if (stryMutAct_9fa48("1446")) {
              {}
            } else {
              stryCov_9fa48("1446");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNPAIRED_SURROGATE, stryMutAct_9fa48("1447") ? "" : (stryCov_9fa48("1447"), "error"), pendingInfo.byteStart, stryMutAct_9fa48("1448") ? "" : (stryCov_9fa48("1448"), "Unpaired surrogate at stream end"), stryMutAct_9fa48("1449") ? true : (stryCov_9fa48("1449"), false)));
            }
          }

          // Check for incomplete UTF-8
          if (stryMutAct_9fa48("1451") ? false : stryMutAct_9fa48("1450") ? true : (stryCov_9fa48("1450", "1451"), this.utf8.hasIncomplete())) {
            if (stryMutAct_9fa48("1452")) {
              {}
            } else {
              stryCov_9fa48("1452");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_INCOMPLETE_UTF8, stryMutAct_9fa48("1453") ? "" : (stryCov_9fa48("1453"), "error"), this.utf8.incompleteByteOffset(), stryMutAct_9fa48("1454") ? "" : (stryCov_9fa48("1454"), "Incomplete UTF-8 sequence at stream end"), stryMutAct_9fa48("1455") ? true : (stryCov_9fa48("1455"), false)));
            }
          }
        }
      }

      // Check for truncation
      if (stryMutAct_9fa48("1458") ? !this.rootComplete || reason !== "complete" : stryMutAct_9fa48("1457") ? false : stryMutAct_9fa48("1456") ? true : (stryCov_9fa48("1456", "1457", "1458"), (stryMutAct_9fa48("1459") ? this.rootComplete : (stryCov_9fa48("1459"), !this.rootComplete)) && (stryMutAct_9fa48("1461") ? reason === "complete" : stryMutAct_9fa48("1460") ? true : (stryCov_9fa48("1460", "1461"), reason !== (stryMutAct_9fa48("1462") ? "" : (stryCov_9fa48("1462"), "complete")))))) {
        if (stryMutAct_9fa48("1463")) {
          {}
        } else {
          stryCov_9fa48("1463");
          // Attempt structural salvage
          let salvaged = stryMutAct_9fa48("1464") ? true : (stryCov_9fa48("1464"), false);
          if (stryMutAct_9fa48("1467") ? this.repairs.closeContainersAtFinish === "safe-only" && this.scanner.currentState === ScannerState.Structural && this.scanner.getPendingInfo().type === "none" && this.grammar.canSafelyCloseAll() && !this.hasFatalDiagnostic() || this.syntax_ !== "invalid" : stryMutAct_9fa48("1466") ? false : stryMutAct_9fa48("1465") ? true : (stryCov_9fa48("1465", "1466", "1467"), (stryMutAct_9fa48("1469") ? this.repairs.closeContainersAtFinish === "safe-only" && this.scanner.currentState === ScannerState.Structural && this.scanner.getPendingInfo().type === "none" && this.grammar.canSafelyCloseAll() || !this.hasFatalDiagnostic() : stryMutAct_9fa48("1468") ? true : (stryCov_9fa48("1468", "1469"), (stryMutAct_9fa48("1471") ? this.repairs.closeContainersAtFinish === "safe-only" && this.scanner.currentState === ScannerState.Structural && this.scanner.getPendingInfo().type === "none" || this.grammar.canSafelyCloseAll() : stryMutAct_9fa48("1470") ? true : (stryCov_9fa48("1470", "1471"), (stryMutAct_9fa48("1473") ? this.repairs.closeContainersAtFinish === "safe-only" && this.scanner.currentState === ScannerState.Structural || this.scanner.getPendingInfo().type === "none" : stryMutAct_9fa48("1472") ? true : (stryCov_9fa48("1472", "1473"), (stryMutAct_9fa48("1475") ? this.repairs.closeContainersAtFinish === "safe-only" || this.scanner.currentState === ScannerState.Structural : stryMutAct_9fa48("1474") ? true : (stryCov_9fa48("1474", "1475"), (stryMutAct_9fa48("1477") ? this.repairs.closeContainersAtFinish !== "safe-only" : stryMutAct_9fa48("1476") ? true : (stryCov_9fa48("1476", "1477"), this.repairs.closeContainersAtFinish === (stryMutAct_9fa48("1478") ? "" : (stryCov_9fa48("1478"), "safe-only")))) && (stryMutAct_9fa48("1480") ? this.scanner.currentState !== ScannerState.Structural : stryMutAct_9fa48("1479") ? true : (stryCov_9fa48("1479", "1480"), this.scanner.currentState === ScannerState.Structural)))) && (stryMutAct_9fa48("1482") ? this.scanner.getPendingInfo().type !== "none" : stryMutAct_9fa48("1481") ? true : (stryCov_9fa48("1481", "1482"), this.scanner.getPendingInfo().type === (stryMutAct_9fa48("1483") ? "" : (stryCov_9fa48("1483"), "none")))))) && this.grammar.canSafelyCloseAll())) && (stryMutAct_9fa48("1484") ? this.hasFatalDiagnostic() : (stryCov_9fa48("1484"), !this.hasFatalDiagnostic())))) && (stryMutAct_9fa48("1486") ? this.syntax_ === "invalid" : stryMutAct_9fa48("1485") ? true : (stryCov_9fa48("1485", "1486"), this.syntax_ !== (stryMutAct_9fa48("1487") ? "" : (stryCov_9fa48("1487"), "invalid")))))) {
            if (stryMutAct_9fa48("1488")) {
              {}
            } else {
              stryCov_9fa48("1488");
              salvaged = stryMutAct_9fa48("1489") ? false : (stryCov_9fa48("1489"), true);
              const frames = this.grammar.getFrames();
              // We know exactly what to close, just close them all
              for (let i = stryMutAct_9fa48("1490") ? frames.length + 1 : (stryCov_9fa48("1490"), frames.length - 1); stryMutAct_9fa48("1493") ? i < 0 : stryMutAct_9fa48("1492") ? i > 0 : stryMutAct_9fa48("1491") ? false : (stryCov_9fa48("1491", "1492", "1493"), i >= 0); stryMutAct_9fa48("1494") ? i++ : (stryCov_9fa48("1494"), i--)) {
                if (stryMutAct_9fa48("1495")) {
                  {}
                } else {
                  stryCov_9fa48("1495");
                  const frame = frames[i];
                  if (stryMutAct_9fa48("1497") ? false : stryMutAct_9fa48("1496") ? true : (stryCov_9fa48("1496", "1497"), frame)) {
                    if (stryMutAct_9fa48("1498")) {
                      {}
                    } else {
                      stryCov_9fa48("1498");
                      this.events.emitContainerClosed(frame.path, frame.containerType);
                    }
                  }
                }
              }
              const repair: RepairAction = stryMutAct_9fa48("1499") ? {} : (stryCov_9fa48("1499"), {
                code: stryMutAct_9fa48("1500") ? "" : (stryCov_9fa48("1500"), "R_CLOSE_CONTAINER"),
                byteRange: stryMutAct_9fa48("1501") ? [] : (stryCov_9fa48("1501"), [this.consumedBytes, this.consumedBytes]),
                impact: stryMutAct_9fa48("1502") ? "" : (stryCov_9fa48("1502"), "structural"),
                description: stryMutAct_9fa48("1503") ? `` : (stryCov_9fa48("1503"), `Safely closed ${frames.length} containers at stream end`)
              });
              this.allRepairs.push(repair);
              this.events.emitRepairApplied(repair);
              this.rootComplete = stryMutAct_9fa48("1504") ? false : (stryCov_9fa48("1504"), true);
            }
          }
          if (stryMutAct_9fa48("1507") ? false : stryMutAct_9fa48("1506") ? true : stryMutAct_9fa48("1505") ? salvaged : (stryCov_9fa48("1505", "1506", "1507"), !salvaged)) {
            if (stryMutAct_9fa48("1508")) {
              {}
            } else {
              stryCov_9fa48("1508");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_STREAM_TRUNCATED, stryMutAct_9fa48("1509") ? "" : (stryCov_9fa48("1509"), "error"), this.consumedBytes, stryMutAct_9fa48("1510") ? `` : (stryCov_9fa48("1510"), `Stream truncated: ${reason}`), stryMutAct_9fa48("1511") ? true : (stryCov_9fa48("1511"), false)));
            }
          }
        }
      } else if (stryMutAct_9fa48("1514") ? !this.rootComplete || reason === "complete" : stryMutAct_9fa48("1513") ? false : stryMutAct_9fa48("1512") ? true : (stryCov_9fa48("1512", "1513", "1514"), (stryMutAct_9fa48("1515") ? this.rootComplete : (stryCov_9fa48("1515"), !this.rootComplete)) && (stryMutAct_9fa48("1517") ? reason !== "complete" : stryMutAct_9fa48("1516") ? true : (stryCov_9fa48("1516", "1517"), reason === (stryMutAct_9fa48("1518") ? "" : (stryCov_9fa48("1518"), "complete")))))) {
        if (stryMutAct_9fa48("1519")) {
          {}
        } else {
          stryCov_9fa48("1519");
          // Stream said complete but root isn't closed
          if (stryMutAct_9fa48("1521") ? false : stryMutAct_9fa48("1520") ? true : (stryCov_9fa48("1520", "1521"), this.hasSeenValue)) {
            if (stryMutAct_9fa48("1522")) {
              {}
            } else {
              stryCov_9fa48("1522");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_STREAM_TRUNCATED, stryMutAct_9fa48("1523") ? "" : (stryCov_9fa48("1523"), "error"), this.consumedBytes, stryMutAct_9fa48("1524") ? "" : (stryCov_9fa48("1524"), "Stream marked complete but JSON root is not closed"), stryMutAct_9fa48("1525") ? true : (stryCov_9fa48("1525"), false)));
            }
          }
        }
      }
      const outcome = this.determineOutcome(reason);
      const executable = this.isExecutable();

      // Emit finish events
      if (stryMutAct_9fa48("1528") ? this.rootComplete && !this.grammar.hasDuplicate || !this.hasFatalDiagnostic() : stryMutAct_9fa48("1527") ? false : stryMutAct_9fa48("1526") ? true : (stryCov_9fa48("1526", "1527", "1528"), (stryMutAct_9fa48("1530") ? this.rootComplete || !this.grammar.hasDuplicate : stryMutAct_9fa48("1529") ? true : (stryCov_9fa48("1529", "1530"), this.rootComplete && (stryMutAct_9fa48("1531") ? this.grammar.hasDuplicate : (stryCov_9fa48("1531"), !this.grammar.hasDuplicate)))) && (stryMutAct_9fa48("1532") ? this.hasFatalDiagnostic() : (stryCov_9fa48("1532"), !this.hasFatalDiagnostic())))) {
        if (stryMutAct_9fa48("1533")) {
          {}
        } else {
          stryCov_9fa48("1533");
          this.events.emitDocumentComplete(executable);
        }
      }
      this.events.emitStreamFinished(outcome);
      return stryMutAct_9fa48("1534") ? {} : (stryCov_9fa48("1534"), {
        syntax: this.syntax_,
        outcome,
        stableValue: this.buildStableValue(),
        executable,
        repairs: Object.freeze(stryMutAct_9fa48("1535") ? [] : (stryCov_9fa48("1535"), [...this.allRepairs])),
        diagnostics: Object.freeze(stryMutAct_9fa48("1536") ? [] : (stryCov_9fa48("1536"), [...this.allDiagnostics])),
        receivedBytes: this.receivedBytes,
        consumedBytes: this.consumedBytes
      });
    }
  }

  // -----------------------------------------------------------------------
  // Token processing
  // -----------------------------------------------------------------------

  private processToken(token: Token): void {
    if (stryMutAct_9fa48("1537")) {
      {}
    } else {
      stryCov_9fa48("1537");
      // Handle value skipping (duplicate key value)
      if (stryMutAct_9fa48("1539") ? false : stryMutAct_9fa48("1538") ? true : (stryCov_9fa48("1538", "1539"), this.isSkippingValue)) {
        if (stryMutAct_9fa48("1540")) {
          {}
        } else {
          stryCov_9fa48("1540");
          if (stryMutAct_9fa48("1543") ? token.type === TokenType.ObjectStart && token.type === TokenType.ArrayStart : stryMutAct_9fa48("1542") ? false : stryMutAct_9fa48("1541") ? true : (stryCov_9fa48("1541", "1542", "1543"), (stryMutAct_9fa48("1545") ? token.type !== TokenType.ObjectStart : stryMutAct_9fa48("1544") ? false : (stryCov_9fa48("1544", "1545"), token.type === TokenType.ObjectStart)) || (stryMutAct_9fa48("1547") ? token.type !== TokenType.ArrayStart : stryMutAct_9fa48("1546") ? false : (stryCov_9fa48("1546", "1547"), token.type === TokenType.ArrayStart)))) {
            if (stryMutAct_9fa48("1548")) {
              {}
            } else {
              stryCov_9fa48("1548");
              stryMutAct_9fa48("1549") ? this.skipValueDepth-- : (stryCov_9fa48("1549"), this.skipValueDepth++);
            }
          } else if (stryMutAct_9fa48("1552") ? token.type === TokenType.ObjectEnd && token.type === TokenType.ArrayEnd : stryMutAct_9fa48("1551") ? false : stryMutAct_9fa48("1550") ? true : (stryCov_9fa48("1550", "1551", "1552"), (stryMutAct_9fa48("1554") ? token.type !== TokenType.ObjectEnd : stryMutAct_9fa48("1553") ? false : (stryCov_9fa48("1553", "1554"), token.type === TokenType.ObjectEnd)) || (stryMutAct_9fa48("1556") ? token.type !== TokenType.ArrayEnd : stryMutAct_9fa48("1555") ? false : (stryCov_9fa48("1555", "1556"), token.type === TokenType.ArrayEnd)))) {
            if (stryMutAct_9fa48("1557")) {
              {}
            } else {
              stryCov_9fa48("1557");
              stryMutAct_9fa48("1558") ? this.skipValueDepth++ : (stryCov_9fa48("1558"), this.skipValueDepth--);
              if (stryMutAct_9fa48("1562") ? this.skipValueDepth > 0 : stryMutAct_9fa48("1561") ? this.skipValueDepth < 0 : stryMutAct_9fa48("1560") ? false : stryMutAct_9fa48("1559") ? true : (stryCov_9fa48("1559", "1560", "1561", "1562"), this.skipValueDepth <= 0)) {
                if (stryMutAct_9fa48("1563")) {
                  {}
                } else {
                  stryCov_9fa48("1563");
                  this.isSkippingValue = stryMutAct_9fa48("1564") ? true : (stryCov_9fa48("1564"), false);
                  this.skipValueDepth = 0;
                  // Resume normal flow — need to advance the object expectation
                  const frame = this.grammar.current;
                  if (stryMutAct_9fa48("1567") ? frame || frame.containerType === "object" : stryMutAct_9fa48("1566") ? false : stryMutAct_9fa48("1565") ? true : (stryCov_9fa48("1565", "1566", "1567"), frame && (stryMutAct_9fa48("1569") ? frame.containerType !== "object" : stryMutAct_9fa48("1568") ? true : (stryCov_9fa48("1568", "1569"), frame.containerType === (stryMutAct_9fa48("1570") ? "" : (stryCov_9fa48("1570"), "object")))))) {
                    if (stryMutAct_9fa48("1571")) {
                      {}
                    } else {
                      stryCov_9fa48("1571");
                      frame.objectExpectation = stryMutAct_9fa48("1572") ? "" : (stryCov_9fa48("1572"), "comma_or_end");
                    }
                  }
                }
              }
            }
          } else if (stryMutAct_9fa48("1575") ? this.skipValueDepth !== 0 : stryMutAct_9fa48("1574") ? false : stryMutAct_9fa48("1573") ? true : (stryCov_9fa48("1573", "1574", "1575"), this.skipValueDepth === 0)) {
            if (stryMutAct_9fa48("1576")) {
              {}
            } else {
              stryCov_9fa48("1576");
              // Scalar value for duplicate key — skip it
              if (stryMutAct_9fa48("1579") ? (token.type === TokenType.String || token.type === TokenType.Number || token.type === TokenType.True || token.type === TokenType.False) && token.type === TokenType.Null : stryMutAct_9fa48("1578") ? false : stryMutAct_9fa48("1577") ? true : (stryCov_9fa48("1577", "1578", "1579"), (stryMutAct_9fa48("1581") ? (token.type === TokenType.String || token.type === TokenType.Number || token.type === TokenType.True) && token.type === TokenType.False : stryMutAct_9fa48("1580") ? false : (stryCov_9fa48("1580", "1581"), (stryMutAct_9fa48("1583") ? (token.type === TokenType.String || token.type === TokenType.Number) && token.type === TokenType.True : stryMutAct_9fa48("1582") ? false : (stryCov_9fa48("1582", "1583"), (stryMutAct_9fa48("1585") ? token.type === TokenType.String && token.type === TokenType.Number : stryMutAct_9fa48("1584") ? false : (stryCov_9fa48("1584", "1585"), (stryMutAct_9fa48("1587") ? token.type !== TokenType.String : stryMutAct_9fa48("1586") ? false : (stryCov_9fa48("1586", "1587"), token.type === TokenType.String)) || (stryMutAct_9fa48("1589") ? token.type !== TokenType.Number : stryMutAct_9fa48("1588") ? false : (stryCov_9fa48("1588", "1589"), token.type === TokenType.Number)))) || (stryMutAct_9fa48("1591") ? token.type !== TokenType.True : stryMutAct_9fa48("1590") ? false : (stryCov_9fa48("1590", "1591"), token.type === TokenType.True)))) || (stryMutAct_9fa48("1593") ? token.type !== TokenType.False : stryMutAct_9fa48("1592") ? false : (stryCov_9fa48("1592", "1593"), token.type === TokenType.False)))) || (stryMutAct_9fa48("1595") ? token.type !== TokenType.Null : stryMutAct_9fa48("1594") ? false : (stryCov_9fa48("1594", "1595"), token.type === TokenType.Null)))) {
                if (stryMutAct_9fa48("1596")) {
                  {}
                } else {
                  stryCov_9fa48("1596");
                  this.isSkippingValue = stryMutAct_9fa48("1597") ? true : (stryCov_9fa48("1597"), false);
                  const frame = this.grammar.current;
                  if (stryMutAct_9fa48("1600") ? frame || frame.containerType === "object" : stryMutAct_9fa48("1599") ? false : stryMutAct_9fa48("1598") ? true : (stryCov_9fa48("1598", "1599", "1600"), frame && (stryMutAct_9fa48("1602") ? frame.containerType !== "object" : stryMutAct_9fa48("1601") ? true : (stryCov_9fa48("1601", "1602"), frame.containerType === (stryMutAct_9fa48("1603") ? "" : (stryCov_9fa48("1603"), "object")))))) {
                    if (stryMutAct_9fa48("1604")) {
                      {}
                    } else {
                      stryCov_9fa48("1604");
                      frame.objectExpectation = stryMutAct_9fa48("1605") ? "" : (stryCov_9fa48("1605"), "comma_or_end");
                    }
                  }
                }
              }
            }
          }
          return;
        }
      }
      switch (token.type) {
        case TokenType.ObjectStart:
          if (stryMutAct_9fa48("1606")) {} else {
            stryCov_9fa48("1606");
            this.handleObjectStart(token);
            break;
          }
        case TokenType.ObjectEnd:
          if (stryMutAct_9fa48("1607")) {} else {
            stryCov_9fa48("1607");
            this.handleObjectEnd(token);
            break;
          }
        case TokenType.ArrayStart:
          if (stryMutAct_9fa48("1608")) {} else {
            stryCov_9fa48("1608");
            this.handleArrayStart(token);
            break;
          }
        case TokenType.ArrayEnd:
          if (stryMutAct_9fa48("1609")) {} else {
            stryCov_9fa48("1609");
            this.handleArrayEnd(token);
            break;
          }
        case TokenType.Colon:
          if (stryMutAct_9fa48("1610")) {} else {
            stryCov_9fa48("1610");
            this.handleColon(token);
            break;
          }
        case TokenType.Comma:
          if (stryMutAct_9fa48("1611")) {} else {
            stryCov_9fa48("1611");
            this.handleComma(token);
            break;
          }
        case TokenType.String:
          if (stryMutAct_9fa48("1612")) {} else {
            stryCov_9fa48("1612");
            this.handleString(token);
            break;
          }
        case TokenType.Number:
          if (stryMutAct_9fa48("1613")) {} else {
            stryCov_9fa48("1613");
            this.handleNumber(token);
            break;
          }
        case TokenType.True:
        case TokenType.False:
        case TokenType.Null:
          if (stryMutAct_9fa48("1614")) {} else {
            stryCov_9fa48("1614");
            this.handleLiteral(token);
            break;
          }
      }
    }
  }
  private handleObjectStart(token: Token): void {
    if (stryMutAct_9fa48("1615")) {
      {}
    } else {
      stryCov_9fa48("1615");
      const frame = this.grammar.current;

      // Validate context
      if (stryMutAct_9fa48("1617") ? false : stryMutAct_9fa48("1616") ? true : (stryCov_9fa48("1616", "1617"), frame)) {
        if (stryMutAct_9fa48("1618")) {
          {}
        } else {
          stryCov_9fa48("1618");
          if (stryMutAct_9fa48("1621") ? frame.containerType !== "object" : stryMutAct_9fa48("1620") ? false : stryMutAct_9fa48("1619") ? true : (stryCov_9fa48("1619", "1620", "1621"), frame.containerType === (stryMutAct_9fa48("1622") ? "" : (stryCov_9fa48("1622"), "object")))) {
            if (stryMutAct_9fa48("1623")) {
              {}
            } else {
              stryCov_9fa48("1623");
              if (stryMutAct_9fa48("1626") ? frame.objectExpectation === "value" : stryMutAct_9fa48("1625") ? false : stryMutAct_9fa48("1624") ? true : (stryCov_9fa48("1624", "1625", "1626"), frame.objectExpectation !== (stryMutAct_9fa48("1627") ? "" : (stryCov_9fa48("1627"), "value")))) {
                if (stryMutAct_9fa48("1628")) {
                  {}
                } else {
                  stryCov_9fa48("1628");
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1629") ? "" : (stryCov_9fa48("1629"), "error"), token.byteStart, stryMutAct_9fa48("1630") ? "" : (stryCov_9fa48("1630"), "Unexpected '{'"), stryMutAct_9fa48("1631") ? true : (stryCov_9fa48("1631"), false)));
                  this.terminal = stryMutAct_9fa48("1632") ? false : (stryCov_9fa48("1632"), true);
                  this.syntax_ = stryMutAct_9fa48("1633") ? "" : (stryCov_9fa48("1633"), "invalid");
                  return;
                }
              }
            }
          } else if (stryMutAct_9fa48("1636") ? frame.containerType !== "array" : stryMutAct_9fa48("1635") ? false : stryMutAct_9fa48("1634") ? true : (stryCov_9fa48("1634", "1635", "1636"), frame.containerType === (stryMutAct_9fa48("1637") ? "" : (stryCov_9fa48("1637"), "array")))) {
            if (stryMutAct_9fa48("1638")) {
              {}
            } else {
              stryCov_9fa48("1638");
              if (stryMutAct_9fa48("1641") ? frame.arrayExpectation !== "first_value_or_end" || frame.arrayExpectation !== "value_after_comma" : stryMutAct_9fa48("1640") ? false : stryMutAct_9fa48("1639") ? true : (stryCov_9fa48("1639", "1640", "1641"), (stryMutAct_9fa48("1643") ? frame.arrayExpectation === "first_value_or_end" : stryMutAct_9fa48("1642") ? true : (stryCov_9fa48("1642", "1643"), frame.arrayExpectation !== (stryMutAct_9fa48("1644") ? "" : (stryCov_9fa48("1644"), "first_value_or_end")))) && (stryMutAct_9fa48("1646") ? frame.arrayExpectation === "value_after_comma" : stryMutAct_9fa48("1645") ? true : (stryCov_9fa48("1645", "1646"), frame.arrayExpectation !== (stryMutAct_9fa48("1647") ? "" : (stryCov_9fa48("1647"), "value_after_comma")))))) {
                if (stryMutAct_9fa48("1648")) {
                  {}
                } else {
                  stryCov_9fa48("1648");
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1649") ? "" : (stryCov_9fa48("1649"), "error"), token.byteStart, stryMutAct_9fa48("1650") ? "" : (stryCov_9fa48("1650"), "Unexpected '{' in array"), stryMutAct_9fa48("1651") ? true : (stryCov_9fa48("1651"), false)));
                  this.terminal = stryMutAct_9fa48("1652") ? false : (stryCov_9fa48("1652"), true);
                  this.syntax_ = stryMutAct_9fa48("1653") ? "" : (stryCov_9fa48("1653"), "invalid");
                  return;
                }
              }
            }
          }
        }
      }
      const newFrame = this.grammar.pushObject(token.byteStart);
      if (stryMutAct_9fa48("1656") ? false : stryMutAct_9fa48("1655") ? true : stryMutAct_9fa48("1654") ? newFrame : (stryCov_9fa48("1654", "1655", "1656"), !newFrame)) {
        if (stryMutAct_9fa48("1657")) {
          {}
        } else {
          stryCov_9fa48("1657");
          this.terminal = stryMutAct_9fa48("1658") ? false : (stryCov_9fa48("1658"), true);
          this.syntax_ = stryMutAct_9fa48("1659") ? "" : (stryCov_9fa48("1659"), "invalid");
          return;
        }
      }
      this.hasSeenValue = stryMutAct_9fa48("1660") ? false : (stryCov_9fa48("1660"), true);
      if (stryMutAct_9fa48("1663") ? this.syntax_ !== "empty" : stryMutAct_9fa48("1662") ? false : stryMutAct_9fa48("1661") ? true : (stryCov_9fa48("1661", "1662", "1663"), this.syntax_ === (stryMutAct_9fa48("1664") ? "" : (stryCov_9fa48("1664"), "empty")))) {
        if (stryMutAct_9fa48("1665")) {
          {}
        } else {
          stryCov_9fa48("1665");
          this.syntax_ = stryMutAct_9fa48("1666") ? "" : (stryCov_9fa48("1666"), "incomplete");
        }
      }

      // Init container in snapshot builder
      if (stryMutAct_9fa48("1669") ? false : stryMutAct_9fa48("1668") ? true : stryMutAct_9fa48("1667") ? this.grammar.isEmpty() : (stryCov_9fa48("1667", "1668", "1669"), !this.grammar.isEmpty())) {
        if (stryMutAct_9fa48("1670")) {
          {}
        } else {
          stryCov_9fa48("1670");
          if (stryMutAct_9fa48("1673") ? this.grammar.depth !== 1 : stryMutAct_9fa48("1672") ? false : stryMutAct_9fa48("1671") ? true : (stryCov_9fa48("1671", "1672", "1673"), this.grammar.depth === 1)) {
            if (stryMutAct_9fa48("1674")) {
              {}
            } else {
              stryCov_9fa48("1674");
              this.snapshot_.initRootObject();
            }
          } else {
            if (stryMutAct_9fa48("1675")) {
              {}
            } else {
              stryCov_9fa48("1675");
              this.snapshot_.initContainer(newFrame.path, stryMutAct_9fa48("1676") ? "" : (stryCov_9fa48("1676"), "object"));
            }
          }
        }
      }
    }
  }
  private handleObjectEnd(token: Token): void {
    if (stryMutAct_9fa48("1677")) {
      {}
    } else {
      stryCov_9fa48("1677");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1680") ? !frame && frame.containerType !== "object" : stryMutAct_9fa48("1679") ? false : stryMutAct_9fa48("1678") ? true : (stryCov_9fa48("1678", "1679", "1680"), (stryMutAct_9fa48("1681") ? frame : (stryCov_9fa48("1681"), !frame)) || (stryMutAct_9fa48("1683") ? frame.containerType === "object" : stryMutAct_9fa48("1682") ? false : (stryCov_9fa48("1682", "1683"), frame.containerType !== (stryMutAct_9fa48("1684") ? "" : (stryCov_9fa48("1684"), "object")))))) {
        if (stryMutAct_9fa48("1685")) {
          {}
        } else {
          stryCov_9fa48("1685");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1686") ? "" : (stryCov_9fa48("1686"), "error"), token.byteStart, stryMutAct_9fa48("1687") ? "" : (stryCov_9fa48("1687"), "Unexpected '}' — no matching open object"), stryMutAct_9fa48("1688") ? true : (stryCov_9fa48("1688"), false)));
          this.terminal = stryMutAct_9fa48("1689") ? false : (stryCov_9fa48("1689"), true);
          this.syntax_ = stryMutAct_9fa48("1690") ? "" : (stryCov_9fa48("1690"), "invalid");
          return;
        }
      }
      if (stryMutAct_9fa48("1693") ? frame.objectExpectation !== "first_key_or_end" || frame.objectExpectation !== "comma_or_end" : stryMutAct_9fa48("1692") ? false : stryMutAct_9fa48("1691") ? true : (stryCov_9fa48("1691", "1692", "1693"), (stryMutAct_9fa48("1695") ? frame.objectExpectation === "first_key_or_end" : stryMutAct_9fa48("1694") ? true : (stryCov_9fa48("1694", "1695"), frame.objectExpectation !== (stryMutAct_9fa48("1696") ? "" : (stryCov_9fa48("1696"), "first_key_or_end")))) && (stryMutAct_9fa48("1698") ? frame.objectExpectation === "comma_or_end" : stryMutAct_9fa48("1697") ? true : (stryCov_9fa48("1697", "1698"), frame.objectExpectation !== (stryMutAct_9fa48("1699") ? "" : (stryCov_9fa48("1699"), "comma_or_end")))))) {
        if (stryMutAct_9fa48("1700")) {
          {}
        } else {
          stryCov_9fa48("1700");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1701") ? "" : (stryCov_9fa48("1701"), "error"), token.byteStart, stryMutAct_9fa48("1702") ? `` : (stryCov_9fa48("1702"), `Unexpected '}' while expecting ${frame.objectExpectation}`), stryMutAct_9fa48("1703") ? true : (stryCov_9fa48("1703"), false)));
          this.terminal = stryMutAct_9fa48("1704") ? false : (stryCov_9fa48("1704"), true);
          this.syntax_ = stryMutAct_9fa48("1705") ? "" : (stryCov_9fa48("1705"), "invalid");
          return;
        }
      }
      this.grammar.pop();
      this.events.emitContainerClosed(frame.path, stryMutAct_9fa48("1706") ? "" : (stryCov_9fa48("1706"), "object"));

      // If this closes the root, emit the full object as committed
      if (stryMutAct_9fa48("1708") ? false : stryMutAct_9fa48("1707") ? true : (stryCov_9fa48("1707", "1708"), this.grammar.isEmpty())) {
        if (stryMutAct_9fa48("1709")) {
          {}
        } else {
          stryCov_9fa48("1709");
          this.rootComplete = stryMutAct_9fa48("1710") ? false : (stryCov_9fa48("1710"), true);
          this.syntax_ = stryMutAct_9fa48("1711") ? "" : (stryCov_9fa48("1711"), "root_complete");
        }
      } else {
        if (stryMutAct_9fa48("1712")) {
          {}
        } else {
          stryCov_9fa48("1712");
          // Value committed for parent
          this.commitContainerToParent(frame.path, token);
        }
      }
    }
  }
  private handleArrayStart(token: Token): void {
    if (stryMutAct_9fa48("1713")) {
      {}
    } else {
      stryCov_9fa48("1713");
      const frame = this.grammar.current;

      // Validate context
      if (stryMutAct_9fa48("1715") ? false : stryMutAct_9fa48("1714") ? true : (stryCov_9fa48("1714", "1715"), frame)) {
        if (stryMutAct_9fa48("1716")) {
          {}
        } else {
          stryCov_9fa48("1716");
          if (stryMutAct_9fa48("1719") ? frame.containerType !== "object" : stryMutAct_9fa48("1718") ? false : stryMutAct_9fa48("1717") ? true : (stryCov_9fa48("1717", "1718", "1719"), frame.containerType === (stryMutAct_9fa48("1720") ? "" : (stryCov_9fa48("1720"), "object")))) {
            if (stryMutAct_9fa48("1721")) {
              {}
            } else {
              stryCov_9fa48("1721");
              if (stryMutAct_9fa48("1724") ? frame.objectExpectation === "value" : stryMutAct_9fa48("1723") ? false : stryMutAct_9fa48("1722") ? true : (stryCov_9fa48("1722", "1723", "1724"), frame.objectExpectation !== (stryMutAct_9fa48("1725") ? "" : (stryCov_9fa48("1725"), "value")))) {
                if (stryMutAct_9fa48("1726")) {
                  {}
                } else {
                  stryCov_9fa48("1726");
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1727") ? "" : (stryCov_9fa48("1727"), "error"), token.byteStart, stryMutAct_9fa48("1728") ? "" : (stryCov_9fa48("1728"), "Unexpected '['"), stryMutAct_9fa48("1729") ? true : (stryCov_9fa48("1729"), false)));
                  this.terminal = stryMutAct_9fa48("1730") ? false : (stryCov_9fa48("1730"), true);
                  this.syntax_ = stryMutAct_9fa48("1731") ? "" : (stryCov_9fa48("1731"), "invalid");
                  return;
                }
              }
            }
          } else if (stryMutAct_9fa48("1734") ? frame.containerType !== "array" : stryMutAct_9fa48("1733") ? false : stryMutAct_9fa48("1732") ? true : (stryCov_9fa48("1732", "1733", "1734"), frame.containerType === (stryMutAct_9fa48("1735") ? "" : (stryCov_9fa48("1735"), "array")))) {
            if (stryMutAct_9fa48("1736")) {
              {}
            } else {
              stryCov_9fa48("1736");
              if (stryMutAct_9fa48("1739") ? frame.arrayExpectation !== "first_value_or_end" || frame.arrayExpectation !== "value_after_comma" : stryMutAct_9fa48("1738") ? false : stryMutAct_9fa48("1737") ? true : (stryCov_9fa48("1737", "1738", "1739"), (stryMutAct_9fa48("1741") ? frame.arrayExpectation === "first_value_or_end" : stryMutAct_9fa48("1740") ? true : (stryCov_9fa48("1740", "1741"), frame.arrayExpectation !== (stryMutAct_9fa48("1742") ? "" : (stryCov_9fa48("1742"), "first_value_or_end")))) && (stryMutAct_9fa48("1744") ? frame.arrayExpectation === "value_after_comma" : stryMutAct_9fa48("1743") ? true : (stryCov_9fa48("1743", "1744"), frame.arrayExpectation !== (stryMutAct_9fa48("1745") ? "" : (stryCov_9fa48("1745"), "value_after_comma")))))) {
                if (stryMutAct_9fa48("1746")) {
                  {}
                } else {
                  stryCov_9fa48("1746");
                  this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1747") ? "" : (stryCov_9fa48("1747"), "error"), token.byteStart, stryMutAct_9fa48("1748") ? "" : (stryCov_9fa48("1748"), "Unexpected '[' in array"), stryMutAct_9fa48("1749") ? true : (stryCov_9fa48("1749"), false)));
                  this.terminal = stryMutAct_9fa48("1750") ? false : (stryCov_9fa48("1750"), true);
                  this.syntax_ = stryMutAct_9fa48("1751") ? "" : (stryCov_9fa48("1751"), "invalid");
                  return;
                }
              }
            }
          }
        }
      }
      const newFrame = this.grammar.pushArray(token.byteStart);
      if (stryMutAct_9fa48("1754") ? false : stryMutAct_9fa48("1753") ? true : stryMutAct_9fa48("1752") ? newFrame : (stryCov_9fa48("1752", "1753", "1754"), !newFrame)) {
        if (stryMutAct_9fa48("1755")) {
          {}
        } else {
          stryCov_9fa48("1755");
          this.terminal = stryMutAct_9fa48("1756") ? false : (stryCov_9fa48("1756"), true);
          this.syntax_ = stryMutAct_9fa48("1757") ? "" : (stryCov_9fa48("1757"), "invalid");
          return;
        }
      }
      this.hasSeenValue = stryMutAct_9fa48("1758") ? false : (stryCov_9fa48("1758"), true);
      if (stryMutAct_9fa48("1761") ? this.syntax_ !== "empty" : stryMutAct_9fa48("1760") ? false : stryMutAct_9fa48("1759") ? true : (stryCov_9fa48("1759", "1760", "1761"), this.syntax_ === (stryMutAct_9fa48("1762") ? "" : (stryCov_9fa48("1762"), "empty")))) {
        if (stryMutAct_9fa48("1763")) {
          {}
        } else {
          stryCov_9fa48("1763");
          this.syntax_ = stryMutAct_9fa48("1764") ? "" : (stryCov_9fa48("1764"), "incomplete");
        }
      }

      // Init container in snapshot builder
      if (stryMutAct_9fa48("1767") ? this.grammar.depth !== 1 : stryMutAct_9fa48("1766") ? false : stryMutAct_9fa48("1765") ? true : (stryCov_9fa48("1765", "1766", "1767"), this.grammar.depth === 1)) {
        if (stryMutAct_9fa48("1768")) {
          {}
        } else {
          stryCov_9fa48("1768");
          this.snapshot_.initRootArray();
        }
      } else {
        if (stryMutAct_9fa48("1769")) {
          {}
        } else {
          stryCov_9fa48("1769");
          this.snapshot_.initContainer(newFrame.path, stryMutAct_9fa48("1770") ? "" : (stryCov_9fa48("1770"), "array"));
        }
      }
    }
  }
  private handleArrayEnd(token: Token): void {
    if (stryMutAct_9fa48("1771")) {
      {}
    } else {
      stryCov_9fa48("1771");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1774") ? !frame && frame.containerType !== "array" : stryMutAct_9fa48("1773") ? false : stryMutAct_9fa48("1772") ? true : (stryCov_9fa48("1772", "1773", "1774"), (stryMutAct_9fa48("1775") ? frame : (stryCov_9fa48("1775"), !frame)) || (stryMutAct_9fa48("1777") ? frame.containerType === "array" : stryMutAct_9fa48("1776") ? false : (stryCov_9fa48("1776", "1777"), frame.containerType !== (stryMutAct_9fa48("1778") ? "" : (stryCov_9fa48("1778"), "array")))))) {
        if (stryMutAct_9fa48("1779")) {
          {}
        } else {
          stryCov_9fa48("1779");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1780") ? "" : (stryCov_9fa48("1780"), "error"), token.byteStart, stryMutAct_9fa48("1781") ? "" : (stryCov_9fa48("1781"), "Unexpected ']' — no matching open array"), stryMutAct_9fa48("1782") ? true : (stryCov_9fa48("1782"), false)));
          this.terminal = stryMutAct_9fa48("1783") ? false : (stryCov_9fa48("1783"), true);
          this.syntax_ = stryMutAct_9fa48("1784") ? "" : (stryCov_9fa48("1784"), "invalid");
          return;
        }
      }
      if (stryMutAct_9fa48("1787") ? frame.arrayExpectation !== "first_value_or_end" || frame.arrayExpectation !== "comma_or_end" : stryMutAct_9fa48("1786") ? false : stryMutAct_9fa48("1785") ? true : (stryCov_9fa48("1785", "1786", "1787"), (stryMutAct_9fa48("1789") ? frame.arrayExpectation === "first_value_or_end" : stryMutAct_9fa48("1788") ? true : (stryCov_9fa48("1788", "1789"), frame.arrayExpectation !== (stryMutAct_9fa48("1790") ? "" : (stryCov_9fa48("1790"), "first_value_or_end")))) && (stryMutAct_9fa48("1792") ? frame.arrayExpectation === "comma_or_end" : stryMutAct_9fa48("1791") ? true : (stryCov_9fa48("1791", "1792"), frame.arrayExpectation !== (stryMutAct_9fa48("1793") ? "" : (stryCov_9fa48("1793"), "comma_or_end")))))) {
        if (stryMutAct_9fa48("1794")) {
          {}
        } else {
          stryCov_9fa48("1794");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1795") ? "" : (stryCov_9fa48("1795"), "error"), token.byteStart, stryMutAct_9fa48("1796") ? "" : (stryCov_9fa48("1796"), "Unexpected ']'"), stryMutAct_9fa48("1797") ? true : (stryCov_9fa48("1797"), false)));
          this.terminal = stryMutAct_9fa48("1798") ? false : (stryCov_9fa48("1798"), true);
          this.syntax_ = stryMutAct_9fa48("1799") ? "" : (stryCov_9fa48("1799"), "invalid");
          return;
        }
      }
      this.grammar.pop();
      this.events.emitContainerClosed(frame.path, stryMutAct_9fa48("1800") ? "" : (stryCov_9fa48("1800"), "array"));
      if (stryMutAct_9fa48("1802") ? false : stryMutAct_9fa48("1801") ? true : (stryCov_9fa48("1801", "1802"), this.grammar.isEmpty())) {
        if (stryMutAct_9fa48("1803")) {
          {}
        } else {
          stryCov_9fa48("1803");
          this.rootComplete = stryMutAct_9fa48("1804") ? false : (stryCov_9fa48("1804"), true);
          this.syntax_ = stryMutAct_9fa48("1805") ? "" : (stryCov_9fa48("1805"), "root_complete");
        }
      } else {
        if (stryMutAct_9fa48("1806")) {
          {}
        } else {
          stryCov_9fa48("1806");
          this.commitContainerToParent(frame.path, token);
        }
      }
    }
  }
  private handleColon(token: Token): void {
    if (stryMutAct_9fa48("1807")) {
      {}
    } else {
      stryCov_9fa48("1807");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1810") ? (!frame || frame.containerType !== "object") && frame.objectExpectation !== "colon" : stryMutAct_9fa48("1809") ? false : stryMutAct_9fa48("1808") ? true : (stryCov_9fa48("1808", "1809", "1810"), (stryMutAct_9fa48("1812") ? !frame && frame.containerType !== "object" : stryMutAct_9fa48("1811") ? false : (stryCov_9fa48("1811", "1812"), (stryMutAct_9fa48("1813") ? frame : (stryCov_9fa48("1813"), !frame)) || (stryMutAct_9fa48("1815") ? frame.containerType === "object" : stryMutAct_9fa48("1814") ? false : (stryCov_9fa48("1814", "1815"), frame.containerType !== (stryMutAct_9fa48("1816") ? "" : (stryCov_9fa48("1816"), "object")))))) || (stryMutAct_9fa48("1818") ? frame.objectExpectation === "colon" : stryMutAct_9fa48("1817") ? false : (stryCov_9fa48("1817", "1818"), frame.objectExpectation !== (stryMutAct_9fa48("1819") ? "" : (stryCov_9fa48("1819"), "colon")))))) {
        if (stryMutAct_9fa48("1820")) {
          {}
        } else {
          stryCov_9fa48("1820");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1821") ? "" : (stryCov_9fa48("1821"), "error"), token.byteStart, stryMutAct_9fa48("1822") ? "" : (stryCov_9fa48("1822"), "Unexpected ':'"), stryMutAct_9fa48("1823") ? true : (stryCov_9fa48("1823"), false)));
          this.terminal = stryMutAct_9fa48("1824") ? false : (stryCov_9fa48("1824"), true);
          this.syntax_ = stryMutAct_9fa48("1825") ? "" : (stryCov_9fa48("1825"), "invalid");
          return;
        }
      }
      frame.objectExpectation = stryMutAct_9fa48("1826") ? "" : (stryCov_9fa48("1826"), "value");
    }
  }
  private handleComma(token: Token): void {
    if (stryMutAct_9fa48("1827")) {
      {}
    } else {
      stryCov_9fa48("1827");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1830") ? false : stryMutAct_9fa48("1829") ? true : stryMutAct_9fa48("1828") ? frame : (stryCov_9fa48("1828", "1829", "1830"), !frame)) {
        if (stryMutAct_9fa48("1831")) {
          {}
        } else {
          stryCov_9fa48("1831");
          this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1832") ? "" : (stryCov_9fa48("1832"), "error"), token.byteStart, stryMutAct_9fa48("1833") ? "" : (stryCov_9fa48("1833"), "Unexpected ','"), stryMutAct_9fa48("1834") ? true : (stryCov_9fa48("1834"), false)));
          this.terminal = stryMutAct_9fa48("1835") ? false : (stryCov_9fa48("1835"), true);
          this.syntax_ = stryMutAct_9fa48("1836") ? "" : (stryCov_9fa48("1836"), "invalid");
          return;
        }
      }
      if (stryMutAct_9fa48("1839") ? frame.containerType !== "object" : stryMutAct_9fa48("1838") ? false : stryMutAct_9fa48("1837") ? true : (stryCov_9fa48("1837", "1838", "1839"), frame.containerType === (stryMutAct_9fa48("1840") ? "" : (stryCov_9fa48("1840"), "object")))) {
        if (stryMutAct_9fa48("1841")) {
          {}
        } else {
          stryCov_9fa48("1841");
          if (stryMutAct_9fa48("1844") ? frame.objectExpectation === "comma_or_end" : stryMutAct_9fa48("1843") ? false : stryMutAct_9fa48("1842") ? true : (stryCov_9fa48("1842", "1843", "1844"), frame.objectExpectation !== (stryMutAct_9fa48("1845") ? "" : (stryCov_9fa48("1845"), "comma_or_end")))) {
            if (stryMutAct_9fa48("1846")) {
              {}
            } else {
              stryCov_9fa48("1846");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1847") ? "" : (stryCov_9fa48("1847"), "error"), token.byteStart, stryMutAct_9fa48("1848") ? "" : (stryCov_9fa48("1848"), "Unexpected ',' in object"), stryMutAct_9fa48("1849") ? true : (stryCov_9fa48("1849"), false)));
              this.terminal = stryMutAct_9fa48("1850") ? false : (stryCov_9fa48("1850"), true);
              this.syntax_ = stryMutAct_9fa48("1851") ? "" : (stryCov_9fa48("1851"), "invalid");
              return;
            }
          }
          frame.objectExpectation = stryMutAct_9fa48("1852") ? "" : (stryCov_9fa48("1852"), "key_after_comma");
        }
      } else {
        if (stryMutAct_9fa48("1853")) {
          {}
        } else {
          stryCov_9fa48("1853");
          if (stryMutAct_9fa48("1856") ? frame.arrayExpectation === "comma_or_end" : stryMutAct_9fa48("1855") ? false : stryMutAct_9fa48("1854") ? true : (stryCov_9fa48("1854", "1855", "1856"), frame.arrayExpectation !== (stryMutAct_9fa48("1857") ? "" : (stryCov_9fa48("1857"), "comma_or_end")))) {
            if (stryMutAct_9fa48("1858")) {
              {}
            } else {
              stryCov_9fa48("1858");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1859") ? "" : (stryCov_9fa48("1859"), "error"), token.byteStart, stryMutAct_9fa48("1860") ? "" : (stryCov_9fa48("1860"), "Unexpected ',' in array"), stryMutAct_9fa48("1861") ? true : (stryCov_9fa48("1861"), false)));
              this.terminal = stryMutAct_9fa48("1862") ? false : (stryCov_9fa48("1862"), true);
              this.syntax_ = stryMutAct_9fa48("1863") ? "" : (stryCov_9fa48("1863"), "invalid");
              return;
            }
          }
          frame.arrayExpectation = stryMutAct_9fa48("1864") ? "" : (stryCov_9fa48("1864"), "value_after_comma");
        }
      }
    }
  }
  private handleString(token: Token): void {
    if (stryMutAct_9fa48("1865")) {
      {}
    } else {
      stryCov_9fa48("1865");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1868") ? false : stryMutAct_9fa48("1867") ? true : stryMutAct_9fa48("1866") ? frame : (stryCov_9fa48("1866", "1867", "1868"), !frame)) {
        if (stryMutAct_9fa48("1869")) {
          {}
        } else {
          stryCov_9fa48("1869");
          // Root-level string value
          this.hasSeenValue = stryMutAct_9fa48("1870") ? false : (stryCov_9fa48("1870"), true);
          this.rootComplete = stryMutAct_9fa48("1871") ? false : (stryCov_9fa48("1871"), true);
          this.syntax_ = stryMutAct_9fa48("1872") ? "" : (stryCov_9fa48("1872"), "root_complete");
          this.events.emitValueCommitted(stryMutAct_9fa48("1873") ? "Stryker was here!" : (stryCov_9fa48("1873"), ""), token.value, stryMutAct_9fa48("1874") ? [] : (stryCov_9fa48("1874"), [token.byteStart, token.byteEnd]));
          this.rootScalarValue = token.value;
          return;
        }
      }
      if (stryMutAct_9fa48("1877") ? frame.containerType !== "object" : stryMutAct_9fa48("1876") ? false : stryMutAct_9fa48("1875") ? true : (stryCov_9fa48("1875", "1876", "1877"), frame.containerType === (stryMutAct_9fa48("1878") ? "" : (stryCov_9fa48("1878"), "object")))) {
        if (stryMutAct_9fa48("1879")) {
          {}
        } else {
          stryCov_9fa48("1879");
          if (stryMutAct_9fa48("1882") ? frame.objectExpectation === "first_key_or_end" && frame.objectExpectation === "key_after_comma" : stryMutAct_9fa48("1881") ? false : stryMutAct_9fa48("1880") ? true : (stryCov_9fa48("1880", "1881", "1882"), (stryMutAct_9fa48("1884") ? frame.objectExpectation !== "first_key_or_end" : stryMutAct_9fa48("1883") ? false : (stryCov_9fa48("1883", "1884"), frame.objectExpectation === (stryMutAct_9fa48("1885") ? "" : (stryCov_9fa48("1885"), "first_key_or_end")))) || (stryMutAct_9fa48("1887") ? frame.objectExpectation !== "key_after_comma" : stryMutAct_9fa48("1886") ? false : (stryCov_9fa48("1886", "1887"), frame.objectExpectation === (stryMutAct_9fa48("1888") ? "" : (stryCov_9fa48("1888"), "key_after_comma")))))) {
            if (stryMutAct_9fa48("1889")) {
              {}
            } else {
              stryCov_9fa48("1889");
              // This is an object key
              const isNew = this.grammar.registerObjectKey(token.value, token.byteStart);
              if (stryMutAct_9fa48("1892") ? false : stryMutAct_9fa48("1891") ? true : stryMutAct_9fa48("1890") ? isNew : (stryCov_9fa48("1890", "1891", "1892"), !isNew)) {
                if (stryMutAct_9fa48("1893")) {
                  {}
                } else {
                  stryCov_9fa48("1893");
                  // Duplicate key — skip the upcoming value
                  // The grammar registered the diagnostic already
                  const dupDiags = this.grammar.takeDiagnostics();
                  for (const d of dupDiags) {
                    if (stryMutAct_9fa48("1894")) {
                      {}
                    } else {
                      stryCov_9fa48("1894");
                      this.addDiagnostic(d);
                    }
                  }
                  frame.objectExpectation = stryMutAct_9fa48("1895") ? "" : (stryCov_9fa48("1895"), "colon");
                  this.isSkippingValue = stryMutAct_9fa48("1896") ? false : (stryCov_9fa48("1896"), true);
                  this.skipValueDepth = 0;
                  return;
                }
              }
              frame.objectExpectation = stryMutAct_9fa48("1897") ? "" : (stryCov_9fa48("1897"), "colon");
            }
          } else if (stryMutAct_9fa48("1900") ? frame.objectExpectation !== "value" : stryMutAct_9fa48("1899") ? false : stryMutAct_9fa48("1898") ? true : (stryCov_9fa48("1898", "1899", "1900"), frame.objectExpectation === (stryMutAct_9fa48("1901") ? "" : (stryCov_9fa48("1901"), "value")))) {
            if (stryMutAct_9fa48("1902")) {
              {}
            } else {
              stryCov_9fa48("1902");
              // This is a string value for an object field
              const path = this.grammar.currentValuePath();
              this.events.emitValueCommitted(path, token.value, stryMutAct_9fa48("1903") ? [] : (stryCov_9fa48("1903"), [token.byteStart, token.byteEnd]));
              this.snapshot_.processEvent(stryMutAct_9fa48("1904") ? {} : (stryCov_9fa48("1904"), {
                type: stryMutAct_9fa48("1905") ? "" : (stryCov_9fa48("1905"), "value_committed"),
                sequence: 0,
                path,
                operation: stryMutAct_9fa48("1906") ? "" : (stryCov_9fa48("1906"), "add"),
                value: token.value,
                byteRange: stryMutAct_9fa48("1907") ? [] : (stryCov_9fa48("1907"), [token.byteStart, token.byteEnd])
              }));
              frame.objectExpectation = stryMutAct_9fa48("1908") ? "" : (stryCov_9fa48("1908"), "comma_or_end");
            }
          }
        }
      } else if (stryMutAct_9fa48("1911") ? frame.containerType !== "array" : stryMutAct_9fa48("1910") ? false : stryMutAct_9fa48("1909") ? true : (stryCov_9fa48("1909", "1910", "1911"), frame.containerType === (stryMutAct_9fa48("1912") ? "" : (stryCov_9fa48("1912"), "array")))) {
        if (stryMutAct_9fa48("1913")) {
          {}
        } else {
          stryCov_9fa48("1913");
          if (stryMutAct_9fa48("1916") ? frame.arrayExpectation !== "first_value_or_end" || frame.arrayExpectation !== "value_after_comma" : stryMutAct_9fa48("1915") ? false : stryMutAct_9fa48("1914") ? true : (stryCov_9fa48("1914", "1915", "1916"), (stryMutAct_9fa48("1918") ? frame.arrayExpectation === "first_value_or_end" : stryMutAct_9fa48("1917") ? true : (stryCov_9fa48("1917", "1918"), frame.arrayExpectation !== (stryMutAct_9fa48("1919") ? "" : (stryCov_9fa48("1919"), "first_value_or_end")))) && (stryMutAct_9fa48("1921") ? frame.arrayExpectation === "value_after_comma" : stryMutAct_9fa48("1920") ? true : (stryCov_9fa48("1920", "1921"), frame.arrayExpectation !== (stryMutAct_9fa48("1922") ? "" : (stryCov_9fa48("1922"), "value_after_comma")))))) {
            if (stryMutAct_9fa48("1923")) {
              {}
            } else {
              stryCov_9fa48("1923");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1924") ? "" : (stryCov_9fa48("1924"), "error"), token.byteStart, stryMutAct_9fa48("1925") ? "" : (stryCov_9fa48("1925"), "Unexpected string in array"), stryMutAct_9fa48("1926") ? true : (stryCov_9fa48("1926"), false)));
              this.terminal = stryMutAct_9fa48("1927") ? false : (stryCov_9fa48("1927"), true);
              this.syntax_ = stryMutAct_9fa48("1928") ? "" : (stryCov_9fa48("1928"), "invalid");
              return;
            }
          }

          // Array element
          const path = this.grammar.currentValuePath();
          this.events.emitValueCommitted(path, token.value, stryMutAct_9fa48("1929") ? [] : (stryCov_9fa48("1929"), [token.byteStart, token.byteEnd]));
          this.snapshot_.processEvent(stryMutAct_9fa48("1930") ? {} : (stryCov_9fa48("1930"), {
            type: stryMutAct_9fa48("1931") ? "" : (stryCov_9fa48("1931"), "value_committed"),
            sequence: 0,
            path,
            operation: stryMutAct_9fa48("1932") ? "" : (stryCov_9fa48("1932"), "add"),
            value: token.value,
            byteRange: stryMutAct_9fa48("1933") ? [] : (stryCov_9fa48("1933"), [token.byteStart, token.byteEnd])
          }));
          this.grammar.advanceArrayIndex();
          frame.arrayExpectation = stryMutAct_9fa48("1934") ? "" : (stryCov_9fa48("1934"), "comma_or_end");
        }
      }
    }
  }
  private handleNumber(token: Token): void {
    if (stryMutAct_9fa48("1935")) {
      {}
    } else {
      stryCov_9fa48("1935");
      const value = Number(token.value);
      this.commitScalar(value, token);
    }
  }
  private handleLiteral(token: Token): void {
    if (stryMutAct_9fa48("1936")) {
      {}
    } else {
      stryCov_9fa48("1936");
      let value: JsonValue;
      if (stryMutAct_9fa48("1939") ? token.type !== TokenType.True : stryMutAct_9fa48("1938") ? false : stryMutAct_9fa48("1937") ? true : (stryCov_9fa48("1937", "1938", "1939"), token.type === TokenType.True)) value = stryMutAct_9fa48("1940") ? false : (stryCov_9fa48("1940"), true);else if (stryMutAct_9fa48("1943") ? token.type !== TokenType.False : stryMutAct_9fa48("1942") ? false : stryMutAct_9fa48("1941") ? true : (stryCov_9fa48("1941", "1942", "1943"), token.type === TokenType.False)) value = stryMutAct_9fa48("1944") ? true : (stryCov_9fa48("1944"), false);else value = null;
      this.commitScalar(value, token);
    }
  }
  private commitScalar(value: JsonValue, token: Token): void {
    if (stryMutAct_9fa48("1945")) {
      {}
    } else {
      stryCov_9fa48("1945");
      const frame = this.grammar.current;
      if (stryMutAct_9fa48("1948") ? false : stryMutAct_9fa48("1947") ? true : stryMutAct_9fa48("1946") ? frame : (stryCov_9fa48("1946", "1947", "1948"), !frame)) {
        if (stryMutAct_9fa48("1949")) {
          {}
        } else {
          stryCov_9fa48("1949");
          // Root-level scalar
          this.hasSeenValue = stryMutAct_9fa48("1950") ? false : (stryCov_9fa48("1950"), true);
          this.rootComplete = stryMutAct_9fa48("1951") ? false : (stryCov_9fa48("1951"), true);
          this.syntax_ = stryMutAct_9fa48("1952") ? "" : (stryCov_9fa48("1952"), "root_complete");
          this.events.emitValueCommitted(stryMutAct_9fa48("1953") ? "Stryker was here!" : (stryCov_9fa48("1953"), ""), value, stryMutAct_9fa48("1954") ? [] : (stryCov_9fa48("1954"), [token.byteStart, token.byteEnd]));
          // Store root scalar in snapshot builder
          // For root scalars, we directly set the root value
          this.rootScalarValue = value;
          return;
        }
      }
      if (stryMutAct_9fa48("1957") ? frame.containerType !== "object" : stryMutAct_9fa48("1956") ? false : stryMutAct_9fa48("1955") ? true : (stryCov_9fa48("1955", "1956", "1957"), frame.containerType === (stryMutAct_9fa48("1958") ? "" : (stryCov_9fa48("1958"), "object")))) {
        if (stryMutAct_9fa48("1959")) {
          {}
        } else {
          stryCov_9fa48("1959");
          if (stryMutAct_9fa48("1962") ? frame.objectExpectation !== "value" : stryMutAct_9fa48("1961") ? false : stryMutAct_9fa48("1960") ? true : (stryCov_9fa48("1960", "1961", "1962"), frame.objectExpectation === (stryMutAct_9fa48("1963") ? "" : (stryCov_9fa48("1963"), "value")))) {
            if (stryMutAct_9fa48("1964")) {
              {}
            } else {
              stryCov_9fa48("1964");
              const path = this.grammar.currentValuePath();
              this.events.emitValueCommitted(path, value, stryMutAct_9fa48("1965") ? [] : (stryCov_9fa48("1965"), [token.byteStart, token.byteEnd]));
              this.snapshot_.processEvent(stryMutAct_9fa48("1966") ? {} : (stryCov_9fa48("1966"), {
                type: stryMutAct_9fa48("1967") ? "" : (stryCov_9fa48("1967"), "value_committed"),
                sequence: 0,
                path,
                operation: stryMutAct_9fa48("1968") ? "" : (stryCov_9fa48("1968"), "add"),
                value,
                byteRange: stryMutAct_9fa48("1969") ? [] : (stryCov_9fa48("1969"), [token.byteStart, token.byteEnd])
              }));
              frame.objectExpectation = stryMutAct_9fa48("1970") ? "" : (stryCov_9fa48("1970"), "comma_or_end");
            }
          }
        }
      } else if (stryMutAct_9fa48("1973") ? frame.containerType !== "array" : stryMutAct_9fa48("1972") ? false : stryMutAct_9fa48("1971") ? true : (stryCov_9fa48("1971", "1972", "1973"), frame.containerType === (stryMutAct_9fa48("1974") ? "" : (stryCov_9fa48("1974"), "array")))) {
        if (stryMutAct_9fa48("1975")) {
          {}
        } else {
          stryCov_9fa48("1975");
          if (stryMutAct_9fa48("1978") ? frame.arrayExpectation !== "first_value_or_end" || frame.arrayExpectation !== "value_after_comma" : stryMutAct_9fa48("1977") ? false : stryMutAct_9fa48("1976") ? true : (stryCov_9fa48("1976", "1977", "1978"), (stryMutAct_9fa48("1980") ? frame.arrayExpectation === "first_value_or_end" : stryMutAct_9fa48("1979") ? true : (stryCov_9fa48("1979", "1980"), frame.arrayExpectation !== (stryMutAct_9fa48("1981") ? "" : (stryCov_9fa48("1981"), "first_value_or_end")))) && (stryMutAct_9fa48("1983") ? frame.arrayExpectation === "value_after_comma" : stryMutAct_9fa48("1982") ? true : (stryCov_9fa48("1982", "1983"), frame.arrayExpectation !== (stryMutAct_9fa48("1984") ? "" : (stryCov_9fa48("1984"), "value_after_comma")))))) {
            if (stryMutAct_9fa48("1985")) {
              {}
            } else {
              stryCov_9fa48("1985");
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1986") ? "" : (stryCov_9fa48("1986"), "error"), token.byteStart, stryMutAct_9fa48("1987") ? "" : (stryCov_9fa48("1987"), "Unexpected scalar in array"), stryMutAct_9fa48("1988") ? true : (stryCov_9fa48("1988"), false)));
              this.terminal = stryMutAct_9fa48("1989") ? false : (stryCov_9fa48("1989"), true);
              this.syntax_ = stryMutAct_9fa48("1990") ? "" : (stryCov_9fa48("1990"), "invalid");
              return;
            }
          }
          const path = this.grammar.currentValuePath();
          this.events.emitValueCommitted(path, value, stryMutAct_9fa48("1991") ? [] : (stryCov_9fa48("1991"), [token.byteStart, token.byteEnd]));
          this.snapshot_.processEvent(stryMutAct_9fa48("1992") ? {} : (stryCov_9fa48("1992"), {
            type: stryMutAct_9fa48("1993") ? "" : (stryCov_9fa48("1993"), "value_committed"),
            sequence: 0,
            path,
            operation: stryMutAct_9fa48("1994") ? "" : (stryCov_9fa48("1994"), "add"),
            value,
            byteRange: stryMutAct_9fa48("1995") ? [] : (stryCov_9fa48("1995"), [token.byteStart, token.byteEnd])
          }));
          this.grammar.advanceArrayIndex();
          frame.arrayExpectation = stryMutAct_9fa48("1996") ? "" : (stryCov_9fa48("1996"), "comma_or_end");
        }
      }
    }
  }
  private commitContainerToParent(_containerPath: string, _token: Token): void {
    if (stryMutAct_9fa48("1997")) {
      {}
    } else {
      stryCov_9fa48("1997");
      const parentFrame = this.grammar.current;
      if (stryMutAct_9fa48("2000") ? false : stryMutAct_9fa48("1999") ? true : stryMutAct_9fa48("1998") ? parentFrame : (stryCov_9fa48("1998", "1999", "2000"), !parentFrame)) return;
      if (stryMutAct_9fa48("2003") ? parentFrame.containerType !== "object" : stryMutAct_9fa48("2002") ? false : stryMutAct_9fa48("2001") ? true : (stryCov_9fa48("2001", "2002", "2003"), parentFrame.containerType === (stryMutAct_9fa48("2004") ? "" : (stryCov_9fa48("2004"), "object")))) {
        if (stryMutAct_9fa48("2005")) {
          {}
        } else {
          stryCov_9fa48("2005");
          // The closed container was a value in the parent object
          // The value_committed for the object field is implicitly done
          // when the container closes
          parentFrame.objectExpectation = stryMutAct_9fa48("2006") ? "" : (stryCov_9fa48("2006"), "comma_or_end");
        }
      } else if (stryMutAct_9fa48("2009") ? parentFrame.containerType !== "array" : stryMutAct_9fa48("2008") ? false : stryMutAct_9fa48("2007") ? true : (stryCov_9fa48("2007", "2008", "2009"), parentFrame.containerType === (stryMutAct_9fa48("2010") ? "" : (stryCov_9fa48("2010"), "array")))) {
        if (stryMutAct_9fa48("2011")) {
          {}
        } else {
          stryCov_9fa48("2011");
          this.grammar.advanceArrayIndex();
          parentFrame.arrayExpectation = stryMutAct_9fa48("2012") ? "" : (stryCov_9fa48("2012"), "comma_or_end");
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private addDiagnostic(diag: Diagnostic): void {
    if (stryMutAct_9fa48("2013")) {
      {}
    } else {
      stryCov_9fa48("2013");
      this.allDiagnostics.push(diag);
      this.events.emitDiagnostic(diag);
    }
  }
  private isExecutable(): boolean {
    if (stryMutAct_9fa48("2014")) {
      {}
    } else {
      stryCov_9fa48("2014");
      if (stryMutAct_9fa48("2017") ? this.phase === "finished" : stryMutAct_9fa48("2016") ? false : stryMutAct_9fa48("2015") ? true : (stryCov_9fa48("2015", "2016", "2017"), this.phase !== (stryMutAct_9fa48("2018") ? "" : (stryCov_9fa48("2018"), "finished")))) return stryMutAct_9fa48("2019") ? true : (stryCov_9fa48("2019"), false);
      if (stryMutAct_9fa48("2022") ? false : stryMutAct_9fa48("2021") ? true : stryMutAct_9fa48("2020") ? this.rootComplete : (stryCov_9fa48("2020", "2021", "2022"), !this.rootComplete)) return stryMutAct_9fa48("2023") ? true : (stryCov_9fa48("2023"), false);
      const reason = stryMutAct_9fa48("2024") ? this.finishMeta?.reason && "unknown" : (stryCov_9fa48("2024"), (stryMutAct_9fa48("2025") ? this.finishMeta.reason : (stryCov_9fa48("2025"), this.finishMeta?.reason)) ?? (stryMutAct_9fa48("2026") ? "" : (stryCov_9fa48("2026"), "unknown")));
      if (stryMutAct_9fa48("2029") ? (reason === "length" || reason === "network_error" || reason === "provider_error" || reason === "cancelled") && reason === "unknown" : stryMutAct_9fa48("2028") ? false : stryMutAct_9fa48("2027") ? true : (stryCov_9fa48("2027", "2028", "2029"), (stryMutAct_9fa48("2031") ? (reason === "length" || reason === "network_error" || reason === "provider_error") && reason === "cancelled" : stryMutAct_9fa48("2030") ? false : (stryCov_9fa48("2030", "2031"), (stryMutAct_9fa48("2033") ? (reason === "length" || reason === "network_error") && reason === "provider_error" : stryMutAct_9fa48("2032") ? false : (stryCov_9fa48("2032", "2033"), (stryMutAct_9fa48("2035") ? reason === "length" && reason === "network_error" : stryMutAct_9fa48("2034") ? false : (stryCov_9fa48("2034", "2035"), (stryMutAct_9fa48("2037") ? reason !== "length" : stryMutAct_9fa48("2036") ? false : (stryCov_9fa48("2036", "2037"), reason === (stryMutAct_9fa48("2038") ? "" : (stryCov_9fa48("2038"), "length")))) || (stryMutAct_9fa48("2040") ? reason !== "network_error" : stryMutAct_9fa48("2039") ? false : (stryCov_9fa48("2039", "2040"), reason === (stryMutAct_9fa48("2041") ? "" : (stryCov_9fa48("2041"), "network_error")))))) || (stryMutAct_9fa48("2043") ? reason !== "provider_error" : stryMutAct_9fa48("2042") ? false : (stryCov_9fa48("2042", "2043"), reason === (stryMutAct_9fa48("2044") ? "" : (stryCov_9fa48("2044"), "provider_error")))))) || (stryMutAct_9fa48("2046") ? reason !== "cancelled" : stryMutAct_9fa48("2045") ? false : (stryCov_9fa48("2045", "2046"), reason === (stryMutAct_9fa48("2047") ? "" : (stryCov_9fa48("2047"), "cancelled")))))) || (stryMutAct_9fa48("2049") ? reason !== "unknown" : stryMutAct_9fa48("2048") ? false : (stryCov_9fa48("2048", "2049"), reason === (stryMutAct_9fa48("2050") ? "" : (stryCov_9fa48("2050"), "unknown")))))) {
        if (stryMutAct_9fa48("2051")) {
          {}
        } else {
          stryCov_9fa48("2051");
          return stryMutAct_9fa48("2052") ? true : (stryCov_9fa48("2052"), false);
        }
      }
      if (stryMutAct_9fa48("2054") ? false : stryMutAct_9fa48("2053") ? true : (stryCov_9fa48("2053", "2054"), this.grammar.hasDuplicate)) return stryMutAct_9fa48("2055") ? true : (stryCov_9fa48("2055"), false);
      if (stryMutAct_9fa48("2057") ? false : stryMutAct_9fa48("2056") ? true : (stryCov_9fa48("2056", "2057"), this.hasFatalDiagnostic())) return stryMutAct_9fa48("2058") ? true : (stryCov_9fa48("2058"), false);
      if (stryMutAct_9fa48("2060") ? false : stryMutAct_9fa48("2059") ? true : (stryCov_9fa48("2059", "2060"), this.hasNonRecoverableError())) return stryMutAct_9fa48("2061") ? true : (stryCov_9fa48("2061"), false);
      if (stryMutAct_9fa48("2064") ? this.allRepairs.every(r => r.impact === "structural" || r.impact === "lossy") : stryMutAct_9fa48("2063") ? false : stryMutAct_9fa48("2062") ? true : (stryCov_9fa48("2062", "2063", "2064"), this.allRepairs.some(stryMutAct_9fa48("2065") ? () => undefined : (stryCov_9fa48("2065"), r => stryMutAct_9fa48("2068") ? r.impact === "structural" && r.impact === "lossy" : stryMutAct_9fa48("2067") ? false : stryMutAct_9fa48("2066") ? true : (stryCov_9fa48("2066", "2067", "2068"), (stryMutAct_9fa48("2070") ? r.impact !== "structural" : stryMutAct_9fa48("2069") ? false : (stryCov_9fa48("2069", "2070"), r.impact === (stryMutAct_9fa48("2071") ? "" : (stryCov_9fa48("2071"), "structural")))) || (stryMutAct_9fa48("2073") ? r.impact !== "lossy" : stryMutAct_9fa48("2072") ? false : (stryCov_9fa48("2072", "2073"), r.impact === (stryMutAct_9fa48("2074") ? "" : (stryCov_9fa48("2074"), "lossy"))))))))) {
        if (stryMutAct_9fa48("2075")) {
          {}
        } else {
          stryCov_9fa48("2075");
          return stryMutAct_9fa48("2076") ? true : (stryCov_9fa48("2076"), false);
        }
      }
      const pendingInfo = this.scanner.getPendingInfo();
      if (stryMutAct_9fa48("2079") ? pendingInfo.type === "none" : stryMutAct_9fa48("2078") ? false : stryMutAct_9fa48("2077") ? true : (stryCov_9fa48("2077", "2078", "2079"), pendingInfo.type !== (stryMutAct_9fa48("2080") ? "" : (stryCov_9fa48("2080"), "none")))) return stryMutAct_9fa48("2081") ? true : (stryCov_9fa48("2081"), false);
      if (stryMutAct_9fa48("2083") ? false : stryMutAct_9fa48("2082") ? true : (stryCov_9fa48("2082", "2083"), this.trailingDataSeen)) return stryMutAct_9fa48("2084") ? true : (stryCov_9fa48("2084"), false);
      return stryMutAct_9fa48("2085") ? false : (stryCov_9fa48("2085"), true);
    }
  }
  private hasFatalDiagnostic(): boolean {
    if (stryMutAct_9fa48("2086")) {
      {}
    } else {
      stryCov_9fa48("2086");
      return stryMutAct_9fa48("2087") ? this.allDiagnostics.every(d => d.severity === "fatal") : (stryCov_9fa48("2087"), this.allDiagnostics.some(stryMutAct_9fa48("2088") ? () => undefined : (stryCov_9fa48("2088"), d => stryMutAct_9fa48("2091") ? d.severity !== "fatal" : stryMutAct_9fa48("2090") ? false : stryMutAct_9fa48("2089") ? true : (stryCov_9fa48("2089", "2090", "2091"), d.severity === (stryMutAct_9fa48("2092") ? "" : (stryCov_9fa48("2092"), "fatal"))))));
    }
  }
  private hasNonRecoverableError(): boolean {
    if (stryMutAct_9fa48("2093")) {
      {}
    } else {
      stryCov_9fa48("2093");
      return stryMutAct_9fa48("2094") ? this.allDiagnostics.every(d => (d.severity === "error" || d.severity === "fatal") && !d.recoverable) : (stryCov_9fa48("2094"), this.allDiagnostics.some(stryMutAct_9fa48("2095") ? () => undefined : (stryCov_9fa48("2095"), d => stryMutAct_9fa48("2098") ? d.severity === "error" || d.severity === "fatal" || !d.recoverable : stryMutAct_9fa48("2097") ? false : stryMutAct_9fa48("2096") ? true : (stryCov_9fa48("2096", "2097", "2098"), (stryMutAct_9fa48("2100") ? d.severity === "error" && d.severity === "fatal" : stryMutAct_9fa48("2099") ? true : (stryCov_9fa48("2099", "2100"), (stryMutAct_9fa48("2102") ? d.severity !== "error" : stryMutAct_9fa48("2101") ? false : (stryCov_9fa48("2101", "2102"), d.severity === (stryMutAct_9fa48("2103") ? "" : (stryCov_9fa48("2103"), "error")))) || (stryMutAct_9fa48("2105") ? d.severity !== "fatal" : stryMutAct_9fa48("2104") ? false : (stryCov_9fa48("2104", "2105"), d.severity === (stryMutAct_9fa48("2106") ? "" : (stryCov_9fa48("2106"), "fatal")))))) && (stryMutAct_9fa48("2107") ? d.recoverable : (stryCov_9fa48("2107"), !d.recoverable))))));
    }
  }
  private determineOutcome(reason: StreamEndReason): FinalResult["outcome"] {
    if (stryMutAct_9fa48("2108")) {
      {}
    } else {
      stryCov_9fa48("2108");
      if (stryMutAct_9fa48("2111") ? this.syntax_ !== "invalid" : stryMutAct_9fa48("2110") ? false : stryMutAct_9fa48("2109") ? true : (stryCov_9fa48("2109", "2110", "2111"), this.syntax_ === (stryMutAct_9fa48("2112") ? "" : (stryCov_9fa48("2112"), "invalid")))) return stryMutAct_9fa48("2113") ? "" : (stryCov_9fa48("2113"), "invalid");
      if (stryMutAct_9fa48("2115") ? false : stryMutAct_9fa48("2114") ? true : (stryCov_9fa48("2114", "2115"), this.hasFatalDiagnostic())) return stryMutAct_9fa48("2116") ? "" : (stryCov_9fa48("2116"), "invalid");
      if (stryMutAct_9fa48("2118") ? false : stryMutAct_9fa48("2117") ? true : (stryCov_9fa48("2117", "2118"), this.grammar.hasDuplicate)) return stryMutAct_9fa48("2119") ? "" : (stryCov_9fa48("2119"), "invalid");

      // Check if salvaged
      const hasSalvage = stryMutAct_9fa48("2120") ? this.allRepairs.every(r => r.code === "R_CLOSE_CONTAINER") : (stryCov_9fa48("2120"), this.allRepairs.some(stryMutAct_9fa48("2121") ? () => undefined : (stryCov_9fa48("2121"), r => stryMutAct_9fa48("2124") ? r.code !== "R_CLOSE_CONTAINER" : stryMutAct_9fa48("2123") ? false : stryMutAct_9fa48("2122") ? true : (stryCov_9fa48("2122", "2123", "2124"), r.code === (stryMutAct_9fa48("2125") ? "" : (stryCov_9fa48("2125"), "R_CLOSE_CONTAINER"))))));
      if (stryMutAct_9fa48("2127") ? false : stryMutAct_9fa48("2126") ? true : (stryCov_9fa48("2126", "2127"), hasSalvage)) return stryMutAct_9fa48("2128") ? "" : (stryCov_9fa48("2128"), "salvaged");
      if (stryMutAct_9fa48("2131") ? false : stryMutAct_9fa48("2130") ? true : stryMutAct_9fa48("2129") ? this.rootComplete : (stryCov_9fa48("2129", "2130", "2131"), !this.rootComplete)) return stryMutAct_9fa48("2132") ? "" : (stryCov_9fa48("2132"), "truncated");
      if (stryMutAct_9fa48("2135") ? reason !== "complete" || reason !== "unknown" : stryMutAct_9fa48("2134") ? false : stryMutAct_9fa48("2133") ? true : (stryCov_9fa48("2133", "2134", "2135"), (stryMutAct_9fa48("2137") ? reason === "complete" : stryMutAct_9fa48("2136") ? true : (stryCov_9fa48("2136", "2137"), reason !== (stryMutAct_9fa48("2138") ? "" : (stryCov_9fa48("2138"), "complete")))) && (stryMutAct_9fa48("2140") ? reason === "unknown" : stryMutAct_9fa48("2139") ? true : (stryCov_9fa48("2139", "2140"), reason !== (stryMutAct_9fa48("2141") ? "" : (stryCov_9fa48("2141"), "unknown")))))) {
        if (stryMutAct_9fa48("2142")) {
          {}
        } else {
          stryCov_9fa48("2142");
          // Reason indicates stream was cut off, but root is magically complete?
          // Since it's complete, the parsed JSON is fully intact.
          // We consider it valid, but potentially non-executable depending on policy.
          return stryMutAct_9fa48("2143") ? "" : (stryCov_9fa48("2143"), "valid");
        }
      }
      return stryMutAct_9fa48("2144") ? "" : (stryCov_9fa48("2144"), "valid");
    }
  }
  private buildStableValue(): JsonValue | undefined {
    if (stryMutAct_9fa48("2145")) {
      {}
    } else {
      stryCov_9fa48("2145");
      if (stryMutAct_9fa48("2148") ? this.rootScalarValue === undefined : stryMutAct_9fa48("2147") ? false : stryMutAct_9fa48("2146") ? true : (stryCov_9fa48("2146", "2147", "2148"), this.rootScalarValue !== undefined)) return this.rootScalarValue;
      return this.snapshot_.getStableValue();
    }
  }
  private buildPendingTokens(): PendingToken[] {
    if (stryMutAct_9fa48("2149")) {
      {}
    } else {
      stryCov_9fa48("2149");
      const pending: PendingToken[] = stryMutAct_9fa48("2150") ? ["Stryker was here"] : (stryCov_9fa48("2150"), []);
      const info = this.scanner.getPendingInfo();
      if (stryMutAct_9fa48("2153") ? info.type === "none" : stryMutAct_9fa48("2152") ? false : stryMutAct_9fa48("2151") ? true : (stryCov_9fa48("2151", "2152", "2153"), info.type !== (stryMutAct_9fa48("2154") ? "" : (stryCov_9fa48("2154"), "none")))) {
        if (stryMutAct_9fa48("2155")) {
          {}
        } else {
          stryCov_9fa48("2155");
          pending.push({
            type: info.type === "object_key" as string ? "object_key" : info.type,
            path: this.grammar.currentValuePath(),
            buffered: info.buffer,
            byteOffset: info.byteStart
          } as PendingToken);
        }
      }
      return pending;
    }
  }
}

/**
 * Get the UTF-8 byte length of a character.
 */
function getUtf8ByteLength(ch: string): number {
  if (stryMutAct_9fa48("2156")) {
    {}
  } else {
    stryCov_9fa48("2156");
    const code = stryMutAct_9fa48("2157") ? ch.codePointAt(0) && 0 : (stryCov_9fa48("2157"), ch.codePointAt(0) ?? 0);
    if (stryMutAct_9fa48("2161") ? code > 0x7f : stryMutAct_9fa48("2160") ? code < 0x7f : stryMutAct_9fa48("2159") ? false : stryMutAct_9fa48("2158") ? true : (stryCov_9fa48("2158", "2159", "2160", "2161"), code <= 0x7f)) return 1;
    if (stryMutAct_9fa48("2165") ? code > 0x7ff : stryMutAct_9fa48("2164") ? code < 0x7ff : stryMutAct_9fa48("2163") ? false : stryMutAct_9fa48("2162") ? true : (stryCov_9fa48("2162", "2163", "2164", "2165"), code <= 0x7ff)) return 2;
    if (stryMutAct_9fa48("2169") ? code > 0xffff : stryMutAct_9fa48("2168") ? code < 0xffff : stryMutAct_9fa48("2167") ? false : stryMutAct_9fa48("2166") ? true : (stryCov_9fa48("2166", "2167", "2168", "2169"), code <= 0xffff)) return 3;
    return 4;
  }
}