// @ts-nocheck
// ---------------------------------------------------------------------------
// Incremental JSON Lexical Scanner
// ---------------------------------------------------------------------------
//
// A character-at-a-time state machine that tokenizes JSON incrementally.
// Each call to `feedChar()` advances the state machine by one character.
// Complete tokens are collected via `takeTokens()`.
//
// The scanner does NOT re-scan previous input. It maintains its state
// between characters and across chunk boundaries.
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
import { ScannerState } from "./states.js";
import { TokenType } from "./tokens.js";
import type { Token } from "./tokens.js";
import type { Diagnostic, RepairAction, ParserOptions } from "../types.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/factory.js";

/** Whitespace characters in JSON. */
function isWhitespace(ch: string): boolean {
  if (stryMutAct_9fa48("484")) {
    {}
  } else {
    stryCov_9fa48("484");
    return stryMutAct_9fa48("487") ? (ch === " " || ch === "\t" || ch === "\n") && ch === "\r" : stryMutAct_9fa48("486") ? false : stryMutAct_9fa48("485") ? true : (stryCov_9fa48("485", "486", "487"), (stryMutAct_9fa48("489") ? (ch === " " || ch === "\t") && ch === "\n" : stryMutAct_9fa48("488") ? false : (stryCov_9fa48("488", "489"), (stryMutAct_9fa48("491") ? ch === " " && ch === "\t" : stryMutAct_9fa48("490") ? false : (stryCov_9fa48("490", "491"), (stryMutAct_9fa48("493") ? ch !== " " : stryMutAct_9fa48("492") ? false : (stryCov_9fa48("492", "493"), ch === (stryMutAct_9fa48("494") ? "" : (stryCov_9fa48("494"), " ")))) || (stryMutAct_9fa48("496") ? ch !== "\t" : stryMutAct_9fa48("495") ? false : (stryCov_9fa48("495", "496"), ch === (stryMutAct_9fa48("497") ? "" : (stryCov_9fa48("497"), "\t")))))) || (stryMutAct_9fa48("499") ? ch !== "\n" : stryMutAct_9fa48("498") ? false : (stryCov_9fa48("498", "499"), ch === (stryMutAct_9fa48("500") ? "" : (stryCov_9fa48("500"), "\n")))))) || (stryMutAct_9fa48("502") ? ch !== "\r" : stryMutAct_9fa48("501") ? false : (stryCov_9fa48("501", "502"), ch === (stryMutAct_9fa48("503") ? "" : (stryCov_9fa48("503"), "\r")))));
  }
}
function isDigit(ch: string): boolean {
  if (stryMutAct_9fa48("504")) {
    {}
  } else {
    stryCov_9fa48("504");
    return stryMutAct_9fa48("507") ? ch >= "0" || ch <= "9" : stryMutAct_9fa48("506") ? false : stryMutAct_9fa48("505") ? true : (stryCov_9fa48("505", "506", "507"), (stryMutAct_9fa48("510") ? ch < "0" : stryMutAct_9fa48("509") ? ch > "0" : stryMutAct_9fa48("508") ? true : (stryCov_9fa48("508", "509", "510"), ch >= (stryMutAct_9fa48("511") ? "" : (stryCov_9fa48("511"), "0")))) && (stryMutAct_9fa48("514") ? ch > "9" : stryMutAct_9fa48("513") ? ch < "9" : stryMutAct_9fa48("512") ? true : (stryCov_9fa48("512", "513", "514"), ch <= (stryMutAct_9fa48("515") ? "" : (stryCov_9fa48("515"), "9")))));
  }
}
function isHexDigit(ch: string): boolean {
  if (stryMutAct_9fa48("516")) {
    {}
  } else {
    stryCov_9fa48("516");
    return stryMutAct_9fa48("519") ? (ch >= "0" && ch <= "9" || ch >= "a" && ch <= "f") && ch >= "A" && ch <= "F" : stryMutAct_9fa48("518") ? false : stryMutAct_9fa48("517") ? true : (stryCov_9fa48("517", "518", "519"), (stryMutAct_9fa48("521") ? ch >= "0" && ch <= "9" && ch >= "a" && ch <= "f" : stryMutAct_9fa48("520") ? false : (stryCov_9fa48("520", "521"), (stryMutAct_9fa48("523") ? ch >= "0" || ch <= "9" : stryMutAct_9fa48("522") ? false : (stryCov_9fa48("522", "523"), (stryMutAct_9fa48("526") ? ch < "0" : stryMutAct_9fa48("525") ? ch > "0" : stryMutAct_9fa48("524") ? true : (stryCov_9fa48("524", "525", "526"), ch >= (stryMutAct_9fa48("527") ? "" : (stryCov_9fa48("527"), "0")))) && (stryMutAct_9fa48("530") ? ch > "9" : stryMutAct_9fa48("529") ? ch < "9" : stryMutAct_9fa48("528") ? true : (stryCov_9fa48("528", "529", "530"), ch <= (stryMutAct_9fa48("531") ? "" : (stryCov_9fa48("531"), "9")))))) || (stryMutAct_9fa48("533") ? ch >= "a" || ch <= "f" : stryMutAct_9fa48("532") ? false : (stryCov_9fa48("532", "533"), (stryMutAct_9fa48("536") ? ch < "a" : stryMutAct_9fa48("535") ? ch > "a" : stryMutAct_9fa48("534") ? true : (stryCov_9fa48("534", "535", "536"), ch >= (stryMutAct_9fa48("537") ? "" : (stryCov_9fa48("537"), "a")))) && (stryMutAct_9fa48("540") ? ch > "f" : stryMutAct_9fa48("539") ? ch < "f" : stryMutAct_9fa48("538") ? true : (stryCov_9fa48("538", "539", "540"), ch <= (stryMutAct_9fa48("541") ? "" : (stryCov_9fa48("541"), "f")))))))) || (stryMutAct_9fa48("543") ? ch >= "A" || ch <= "F" : stryMutAct_9fa48("542") ? false : (stryCov_9fa48("542", "543"), (stryMutAct_9fa48("546") ? ch < "A" : stryMutAct_9fa48("545") ? ch > "A" : stryMutAct_9fa48("544") ? true : (stryCov_9fa48("544", "545", "546"), ch >= (stryMutAct_9fa48("547") ? "" : (stryCov_9fa48("547"), "A")))) && (stryMutAct_9fa48("550") ? ch > "F" : stryMutAct_9fa48("549") ? ch < "F" : stryMutAct_9fa48("548") ? true : (stryCov_9fa48("548", "549", "550"), ch <= (stryMutAct_9fa48("551") ? "" : (stryCov_9fa48("551"), "F")))))));
  }
}

/**
 * Incremental JSON scanner.
 * Feed characters one at a time via feedChar().
 * Collect tokens via takeTokens().
 */
export class Scanner {
  private options: ParserOptions;
  constructor(options?: ParserOptions) {
    if (stryMutAct_9fa48("552")) {
      {}
    } else {
      stryCov_9fa48("552");
      this.options = stryMutAct_9fa48("553") ? options && {} : (stryCov_9fa48("553"), options ?? {});
    }
  }
  private state: ScannerState = ScannerState.Structural;
  private tokens: Token[] = stryMutAct_9fa48("554") ? ["Stryker was here"] : (stryCov_9fa48("554"), []);
  private diagnostics: Diagnostic[] = stryMutAct_9fa48("555") ? ["Stryker was here"] : (stryCov_9fa48("555"), []);
  private repairs: RepairAction[] = stryMutAct_9fa48("556") ? ["Stryker was here"] : (stryCov_9fa48("556"), []);

  // --- String state ---
  private stringBuffer = stryMutAct_9fa48("557") ? "Stryker was here!" : (stryCov_9fa48("557"), "");
  private stringIsKey = stryMutAct_9fa48("558") ? true : (stryCov_9fa48("558"), false);
  private stringByteStart = 0;

  // --- Unicode escape state ---
  private unicodeHexBuffer = stryMutAct_9fa48("559") ? "Stryker was here!" : (stryCov_9fa48("559"), "");
  private highSurrogate = 0;
  /** Tracks position in surrogate pair sequence: 0=initial, 1=saw backslash, 2=saw 'u' */
  private surrogatePhase = 0;

  // --- Number state ---
  private numberBuffer = stryMutAct_9fa48("560") ? "Stryker was here!" : (stryCov_9fa48("560"), "");
  private numberByteStart = 0;
  private numberHasDigit = stryMutAct_9fa48("561") ? true : (stryCov_9fa48("561"), false);

  // --- Literal state ---
  private literalTarget = stryMutAct_9fa48("562") ? "Stryker was here!" : (stryCov_9fa48("562"), "");
  private literalIndex = 0;
  private literalByteStart = 0;

  // --- Byte offset tracking ---
  /** Byte offset of the current character being fed. Set by the caller. */
  private currentByteOffset = 0;

  // --- Depth tracking for string context ---
  /** Whether we're in a key position for string parsing. */
  private nextStringIsKey = stryMutAct_9fa48("563") ? true : (stryCov_9fa48("563"), false);
  get currentState(): ScannerState {
    if (stryMutAct_9fa48("564")) {
      {}
    } else {
      stryCov_9fa48("564");
      return this.state;
    }
  }

  /**
   * Feed a single character to the scanner.
   * @param ch - The character to process.
   * @param byteOffset - Absolute byte offset of this character in the input stream.
   * @param charByteLength - Number of bytes this character occupies in UTF-8.
   */
  feedChar(ch: string, byteOffset: number, charByteLength: number): void {
    if (stryMutAct_9fa48("565")) {
      {}
    } else {
      stryCov_9fa48("565");
      this.currentByteOffset = byteOffset;
      switch (this.state) {
        case ScannerState.Structural:
          if (stryMutAct_9fa48("566")) {} else {
            stryCov_9fa48("566");
            this.processStructural(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.ObjectKey:
          if (stryMutAct_9fa48("567")) {} else {
            stryCov_9fa48("567");
            this.processObjectKey(ch, byteOffset);
            break;
          }
        case ScannerState.InString:
          if (stryMutAct_9fa48("568")) {} else {
            stryCov_9fa48("568");
            this.processString(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.Escape:
          if (stryMutAct_9fa48("569")) {} else {
            stryCov_9fa48("569");
            this.processEscape(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.UnicodeEscape:
          if (stryMutAct_9fa48("570")) {} else {
            stryCov_9fa48("570");
            this.processUnicodeEscape(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.UnicodeSurrogatePending:
          if (stryMutAct_9fa48("571")) {} else {
            stryCov_9fa48("571");
            this.processSurrogatePending(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.NumberInteger:
        case ScannerState.NumberFraction:
        case ScannerState.NumberExponentStart:
        case ScannerState.NumberExponent:
          if (stryMutAct_9fa48("572")) {} else {
            stryCov_9fa48("572");
            this.processNumber(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.LiteralTrue:
        case ScannerState.LiteralFalse:
        case ScannerState.LiteralNull:
          if (stryMutAct_9fa48("573")) {} else {
            stryCov_9fa48("573");
            this.processLiteral(ch, byteOffset, charByteLength);
            break;
          }
        case ScannerState.TrailingWhitespace:
          if (stryMutAct_9fa48("574")) {} else {
            stryCov_9fa48("574");
            this.processTrailingWhitespace(ch, byteOffset);
            break;
          }
        case ScannerState.TrailingData:
          if (stryMutAct_9fa48("575")) {} else {
            stryCov_9fa48("575");
            // Consume all trailing data silently — diagnostic was already emitted
            break;
          }
        case ScannerState.Invalid:
        case ScannerState.Finished:
          if (stryMutAct_9fa48("576")) {} else {
            stryCov_9fa48("576");
            // No-op — terminal states
            break;
          }
      }
    }
  }

  /**
   * Take all tokens accumulated since the last call.
   * Clears the internal token buffer.
   */
  takeTokens(): Token[] {
    if (stryMutAct_9fa48("577")) {
      {}
    } else {
      stryCov_9fa48("577");
      const result = this.tokens;
      this.tokens = stryMutAct_9fa48("578") ? ["Stryker was here"] : (stryCov_9fa48("578"), []);
      return result;
    }
  }

  /**
   * Take all diagnostics accumulated since the last call.
   * Clears the internal diagnostic buffer.
   */
  takeDiagnostics(): Diagnostic[] {
    if (stryMutAct_9fa48("579")) {
      {}
    } else {
      stryCov_9fa48("579");
      const result = this.diagnostics;
      this.diagnostics = stryMutAct_9fa48("580") ? ["Stryker was here"] : (stryCov_9fa48("580"), []);
      return result;
    }
  }
  takeRepairs(): RepairAction[] {
    if (stryMutAct_9fa48("581")) {
      {}
    } else {
      stryCov_9fa48("581");
      const result = this.repairs;
      this.repairs = stryMutAct_9fa48("582") ? ["Stryker was here"] : (stryCov_9fa48("582"), []);
      return result;
    }
  }

  /**
   * Set whether the next string to be scanned should be treated as an object key.
   */
  setNextStringIsKey(isKey: boolean): void {
    if (stryMutAct_9fa48("583")) {
      {}
    } else {
      stryCov_9fa48("583");
      this.nextStringIsKey = isKey;
    }
  }

  /**
   * Get info about any pending (incomplete) value.
   */
  getPendingInfo(): {
    type: "string" | "number" | "literal" | "unicode_escape" | "surrogate" | "none";
    buffer: string;
    byteStart: number;
    isKey: boolean;
  } {
    if (stryMutAct_9fa48("584")) {
      {}
    } else {
      stryCov_9fa48("584");
      switch (this.state) {
        case ScannerState.InString:
        case ScannerState.Escape:
          if (stryMutAct_9fa48("585")) {} else {
            stryCov_9fa48("585");
            return stryMutAct_9fa48("586") ? {} : (stryCov_9fa48("586"), {
              type: this.stringIsKey ? "object_key" as "string" : stryMutAct_9fa48("587") ? "" : (stryCov_9fa48("587"), "string"),
              buffer: this.stringBuffer,
              byteStart: this.stringByteStart,
              isKey: this.stringIsKey
            });
          }
        case ScannerState.UnicodeEscape:
          if (stryMutAct_9fa48("588")) {} else {
            stryCov_9fa48("588");
            return stryMutAct_9fa48("589") ? {} : (stryCov_9fa48("589"), {
              type: stryMutAct_9fa48("590") ? "" : (stryCov_9fa48("590"), "unicode_escape"),
              buffer: this.unicodeHexBuffer,
              byteStart: this.stringByteStart,
              isKey: this.stringIsKey
            });
          }
        case ScannerState.UnicodeSurrogatePending:
          if (stryMutAct_9fa48("591")) {} else {
            stryCov_9fa48("591");
            return stryMutAct_9fa48("592") ? {} : (stryCov_9fa48("592"), {
              type: stryMutAct_9fa48("593") ? "" : (stryCov_9fa48("593"), "surrogate"),
              buffer: this.stringBuffer,
              byteStart: this.stringByteStart,
              isKey: this.stringIsKey
            });
          }
        case ScannerState.NumberInteger:
        case ScannerState.NumberFraction:
        case ScannerState.NumberExponentStart:
        case ScannerState.NumberExponent:
          if (stryMutAct_9fa48("594")) {} else {
            stryCov_9fa48("594");
            return stryMutAct_9fa48("595") ? {} : (stryCov_9fa48("595"), {
              type: stryMutAct_9fa48("596") ? "" : (stryCov_9fa48("596"), "number"),
              buffer: this.numberBuffer,
              byteStart: this.numberByteStart,
              isKey: stryMutAct_9fa48("597") ? true : (stryCov_9fa48("597"), false)
            });
          }
        case ScannerState.LiteralTrue:
        case ScannerState.LiteralFalse:
        case ScannerState.LiteralNull:
          if (stryMutAct_9fa48("598")) {} else {
            stryCov_9fa48("598");
            return stryMutAct_9fa48("599") ? {} : (stryCov_9fa48("599"), {
              type: stryMutAct_9fa48("600") ? "" : (stryCov_9fa48("600"), "literal"),
              buffer: stryMutAct_9fa48("601") ? this.literalTarget : (stryCov_9fa48("601"), this.literalTarget.slice(0, this.literalIndex)),
              byteStart: this.literalByteStart,
              isKey: stryMutAct_9fa48("602") ? true : (stryCov_9fa48("602"), false)
            });
          }
        default:
          if (stryMutAct_9fa48("603")) {} else {
            stryCov_9fa48("603");
            return stryMutAct_9fa48("604") ? {} : (stryCov_9fa48("604"), {
              type: stryMutAct_9fa48("605") ? "" : (stryCov_9fa48("605"), "none"),
              buffer: stryMutAct_9fa48("606") ? "Stryker was here!" : (stryCov_9fa48("606"), ""),
              byteStart: 0,
              isKey: stryMutAct_9fa48("607") ? true : (stryCov_9fa48("607"), false)
            });
          }
      }
    }
  }

  /**
   * Attempt to finalize a pending number (at end of input or finish).
   * Returns true if a number token was emitted.
   */
  finalizeNumber(): boolean {
    if (stryMutAct_9fa48("608")) {
      {}
    } else {
      stryCov_9fa48("608");
      if (stryMutAct_9fa48("611") ? (this.state === ScannerState.NumberInteger || this.state === ScannerState.NumberFraction) && this.state === ScannerState.NumberExponent : stryMutAct_9fa48("610") ? false : stryMutAct_9fa48("609") ? true : (stryCov_9fa48("609", "610", "611"), (stryMutAct_9fa48("613") ? this.state === ScannerState.NumberInteger && this.state === ScannerState.NumberFraction : stryMutAct_9fa48("612") ? false : (stryCov_9fa48("612", "613"), (stryMutAct_9fa48("615") ? this.state !== ScannerState.NumberInteger : stryMutAct_9fa48("614") ? false : (stryCov_9fa48("614", "615"), this.state === ScannerState.NumberInteger)) || (stryMutAct_9fa48("617") ? this.state !== ScannerState.NumberFraction : stryMutAct_9fa48("616") ? false : (stryCov_9fa48("616", "617"), this.state === ScannerState.NumberFraction)))) || (stryMutAct_9fa48("619") ? this.state !== ScannerState.NumberExponent : stryMutAct_9fa48("618") ? false : (stryCov_9fa48("618", "619"), this.state === ScannerState.NumberExponent)))) {
        if (stryMutAct_9fa48("620")) {
          {}
        } else {
          stryCov_9fa48("620");
          if (stryMutAct_9fa48("622") ? false : stryMutAct_9fa48("621") ? true : (stryCov_9fa48("621", "622"), this.numberHasDigit)) {
            if (stryMutAct_9fa48("623")) {
              {}
            } else {
              stryCov_9fa48("623");
              this.emitToken(TokenType.Number, this.numberBuffer, this.numberByteStart, stryMutAct_9fa48("624") ? this.currentByteOffset - 1 : (stryCov_9fa48("624"), this.currentByteOffset + 1));
              this.state = ScannerState.TrailingWhitespace;
              return stryMutAct_9fa48("625") ? false : (stryCov_9fa48("625"), true);
            }
          }
        }
      }
      return stryMutAct_9fa48("626") ? true : (stryCov_9fa48("626"), false);
    }
  }

  /**
   * Attempt to finalize a pending literal (at end of input or finish).
   * Returns true if a literal token was emitted.
   */
  finalizeLiteral(): boolean {
    if (stryMutAct_9fa48("627")) {
      {}
    } else {
      stryCov_9fa48("627");
      if (stryMutAct_9fa48("630") ? (this.state === ScannerState.LiteralTrue || this.state === ScannerState.LiteralFalse) && this.state === ScannerState.LiteralNull : stryMutAct_9fa48("629") ? false : stryMutAct_9fa48("628") ? true : (stryCov_9fa48("628", "629", "630"), (stryMutAct_9fa48("632") ? this.state === ScannerState.LiteralTrue && this.state === ScannerState.LiteralFalse : stryMutAct_9fa48("631") ? false : (stryCov_9fa48("631", "632"), (stryMutAct_9fa48("634") ? this.state !== ScannerState.LiteralTrue : stryMutAct_9fa48("633") ? false : (stryCov_9fa48("633", "634"), this.state === ScannerState.LiteralTrue)) || (stryMutAct_9fa48("636") ? this.state !== ScannerState.LiteralFalse : stryMutAct_9fa48("635") ? false : (stryCov_9fa48("635", "636"), this.state === ScannerState.LiteralFalse)))) || (stryMutAct_9fa48("638") ? this.state !== ScannerState.LiteralNull : stryMutAct_9fa48("637") ? false : (stryCov_9fa48("637", "638"), this.state === ScannerState.LiteralNull)))) {
        if (stryMutAct_9fa48("639")) {
          {}
        } else {
          stryCov_9fa48("639");
          if (stryMutAct_9fa48("642") ? this.literalIndex !== this.literalTarget.length : stryMutAct_9fa48("641") ? false : stryMutAct_9fa48("640") ? true : (stryCov_9fa48("640", "641", "642"), this.literalIndex === this.literalTarget.length)) {
            if (stryMutAct_9fa48("643")) {
              {}
            } else {
              stryCov_9fa48("643");
              const type = (stryMutAct_9fa48("646") ? this.literalTarget !== "true" : stryMutAct_9fa48("645") ? false : stryMutAct_9fa48("644") ? true : (stryCov_9fa48("644", "645", "646"), this.literalTarget === (stryMutAct_9fa48("647") ? "" : (stryCov_9fa48("647"), "true")))) ? TokenType.True : (stryMutAct_9fa48("650") ? this.literalTarget !== "false" : stryMutAct_9fa48("649") ? false : stryMutAct_9fa48("648") ? true : (stryCov_9fa48("648", "649", "650"), this.literalTarget === (stryMutAct_9fa48("651") ? "" : (stryCov_9fa48("651"), "false")))) ? TokenType.False : TokenType.Null;
              this.emitToken(type, this.literalTarget, this.literalByteStart, stryMutAct_9fa48("652") ? this.currentByteOffset - 1 : (stryCov_9fa48("652"), this.currentByteOffset + 1));
              this.state = ScannerState.TrailingWhitespace;
              return stryMutAct_9fa48("653") ? false : (stryCov_9fa48("653"), true);
            }
          }
        }
      }
      return stryMutAct_9fa48("654") ? true : (stryCov_9fa48("654"), false);
    }
  }

  // -----------------------------------------------------------------------
  // State handlers
  // -----------------------------------------------------------------------

  private processStructural(ch: string, byteOffset: number, charByteLen: number): void {
    if (stryMutAct_9fa48("655")) {
      {}
    } else {
      stryCov_9fa48("655");
      if (stryMutAct_9fa48("657") ? false : stryMutAct_9fa48("656") ? true : (stryCov_9fa48("656", "657"), isWhitespace(ch))) return;
      if (stryMutAct_9fa48("660") ? ch !== "{" : stryMutAct_9fa48("659") ? false : stryMutAct_9fa48("658") ? true : (stryCov_9fa48("658", "659", "660"), ch === (stryMutAct_9fa48("661") ? "" : (stryCov_9fa48("661"), "{")))) {
        if (stryMutAct_9fa48("662")) {
          {}
        } else {
          stryCov_9fa48("662");
          this.emitToken(TokenType.ObjectStart, stryMutAct_9fa48("663") ? "" : (stryCov_9fa48("663"), "{"), byteOffset, stryMutAct_9fa48("664") ? byteOffset - charByteLen : (stryCov_9fa48("664"), byteOffset + charByteLen));
          this.state = ScannerState.Structural;
        }
      } else if (stryMutAct_9fa48("667") ? ch !== "[" : stryMutAct_9fa48("666") ? false : stryMutAct_9fa48("665") ? true : (stryCov_9fa48("665", "666", "667"), ch === (stryMutAct_9fa48("668") ? "" : (stryCov_9fa48("668"), "[")))) {
        if (stryMutAct_9fa48("669")) {
          {}
        } else {
          stryCov_9fa48("669");
          this.emitToken(TokenType.ArrayStart, stryMutAct_9fa48("670") ? "" : (stryCov_9fa48("670"), "["), byteOffset, stryMutAct_9fa48("671") ? byteOffset - charByteLen : (stryCov_9fa48("671"), byteOffset + charByteLen));
          this.state = ScannerState.Structural;
        }
      } else if (stryMutAct_9fa48("674") ? ch !== "}" : stryMutAct_9fa48("673") ? false : stryMutAct_9fa48("672") ? true : (stryCov_9fa48("672", "673", "674"), ch === (stryMutAct_9fa48("675") ? "" : (stryCov_9fa48("675"), "}")))) {
        if (stryMutAct_9fa48("676")) {
          {}
        } else {
          stryCov_9fa48("676");
          this.emitToken(TokenType.ObjectEnd, stryMutAct_9fa48("677") ? "" : (stryCov_9fa48("677"), "}"), byteOffset, stryMutAct_9fa48("678") ? byteOffset - charByteLen : (stryCov_9fa48("678"), byteOffset + charByteLen));
        }
      } else if (stryMutAct_9fa48("681") ? ch !== "]" : stryMutAct_9fa48("680") ? false : stryMutAct_9fa48("679") ? true : (stryCov_9fa48("679", "680", "681"), ch === (stryMutAct_9fa48("682") ? "" : (stryCov_9fa48("682"), "]")))) {
        if (stryMutAct_9fa48("683")) {
          {}
        } else {
          stryCov_9fa48("683");
          this.emitToken(TokenType.ArrayEnd, stryMutAct_9fa48("684") ? "" : (stryCov_9fa48("684"), "]"), byteOffset, stryMutAct_9fa48("685") ? byteOffset - charByteLen : (stryCov_9fa48("685"), byteOffset + charByteLen));
        }
      } else if (stryMutAct_9fa48("688") ? ch !== "," : stryMutAct_9fa48("687") ? false : stryMutAct_9fa48("686") ? true : (stryCov_9fa48("686", "687", "688"), ch === (stryMutAct_9fa48("689") ? "" : (stryCov_9fa48("689"), ",")))) {
        if (stryMutAct_9fa48("690")) {
          {}
        } else {
          stryCov_9fa48("690");
          this.emitToken(TokenType.Comma, stryMutAct_9fa48("691") ? "" : (stryCov_9fa48("691"), ","), byteOffset, stryMutAct_9fa48("692") ? byteOffset - charByteLen : (stryCov_9fa48("692"), byteOffset + charByteLen));
        }
      } else if (stryMutAct_9fa48("695") ? ch !== ":" : stryMutAct_9fa48("694") ? false : stryMutAct_9fa48("693") ? true : (stryCov_9fa48("693", "694", "695"), ch === (stryMutAct_9fa48("696") ? "" : (stryCov_9fa48("696"), ":")))) {
        if (stryMutAct_9fa48("697")) {
          {}
        } else {
          stryCov_9fa48("697");
          this.emitToken(TokenType.Colon, stryMutAct_9fa48("698") ? "" : (stryCov_9fa48("698"), ":"), byteOffset, stryMutAct_9fa48("699") ? byteOffset - charByteLen : (stryCov_9fa48("699"), byteOffset + charByteLen));
        }
      } else if (stryMutAct_9fa48("702") ? ch !== '"' : stryMutAct_9fa48("701") ? false : stryMutAct_9fa48("700") ? true : (stryCov_9fa48("700", "701", "702"), ch === (stryMutAct_9fa48("703") ? "" : (stryCov_9fa48("703"), '"')))) {
        if (stryMutAct_9fa48("704")) {
          {}
        } else {
          stryCov_9fa48("704");
          this.beginString(byteOffset);
        }
      } else if (stryMutAct_9fa48("707") ? ch === "-" && isDigit(ch) : stryMutAct_9fa48("706") ? false : stryMutAct_9fa48("705") ? true : (stryCov_9fa48("705", "706", "707"), (stryMutAct_9fa48("709") ? ch !== "-" : stryMutAct_9fa48("708") ? false : (stryCov_9fa48("708", "709"), ch === (stryMutAct_9fa48("710") ? "" : (stryCov_9fa48("710"), "-")))) || isDigit(ch))) {
        if (stryMutAct_9fa48("711")) {
          {}
        } else {
          stryCov_9fa48("711");
          this.beginNumber(ch, byteOffset);
        }
      } else if (stryMutAct_9fa48("714") ? ch !== "t" : stryMutAct_9fa48("713") ? false : stryMutAct_9fa48("712") ? true : (stryCov_9fa48("712", "713", "714"), ch === (stryMutAct_9fa48("715") ? "" : (stryCov_9fa48("715"), "t")))) {
        if (stryMutAct_9fa48("716")) {
          {}
        } else {
          stryCov_9fa48("716");
          this.beginLiteral(stryMutAct_9fa48("717") ? "" : (stryCov_9fa48("717"), "true"), byteOffset);
        }
      } else if (stryMutAct_9fa48("720") ? ch !== "f" : stryMutAct_9fa48("719") ? false : stryMutAct_9fa48("718") ? true : (stryCov_9fa48("718", "719", "720"), ch === (stryMutAct_9fa48("721") ? "" : (stryCov_9fa48("721"), "f")))) {
        if (stryMutAct_9fa48("722")) {
          {}
        } else {
          stryCov_9fa48("722");
          this.beginLiteral(stryMutAct_9fa48("723") ? "" : (stryCov_9fa48("723"), "false"), byteOffset);
        }
      } else if (stryMutAct_9fa48("726") ? ch !== "n" : stryMutAct_9fa48("725") ? false : stryMutAct_9fa48("724") ? true : (stryCov_9fa48("724", "725", "726"), ch === (stryMutAct_9fa48("727") ? "" : (stryCov_9fa48("727"), "n")))) {
        if (stryMutAct_9fa48("728")) {
          {}
        } else {
          stryCov_9fa48("728");
          this.beginLiteral(stryMutAct_9fa48("729") ? "" : (stryCov_9fa48("729"), "null"), byteOffset);
        }
      } else {
        if (stryMutAct_9fa48("730")) {
          {}
        } else {
          stryCov_9fa48("730");
          this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("731") ? "" : (stryCov_9fa48("731"), "error"), byteOffset, stryMutAct_9fa48("732") ? `` : (stryCov_9fa48("732"), `Unexpected character: ${JSON.stringify(ch)}`), stryMutAct_9fa48("733") ? true : (stryCov_9fa48("733"), false));
          this.state = ScannerState.Invalid;
        }
      }
    }
  }
  private processObjectKey(ch: string, byteOffset: number): void {
    if (stryMutAct_9fa48("734")) {
      {}
    } else {
      stryCov_9fa48("734");
      if (stryMutAct_9fa48("736") ? false : stryMutAct_9fa48("735") ? true : (stryCov_9fa48("735", "736"), isWhitespace(ch))) return;
      if (stryMutAct_9fa48("739") ? ch !== '"' : stryMutAct_9fa48("738") ? false : stryMutAct_9fa48("737") ? true : (stryCov_9fa48("737", "738", "739"), ch === (stryMutAct_9fa48("740") ? "" : (stryCov_9fa48("740"), '"')))) {
        if (stryMutAct_9fa48("741")) {
          {}
        } else {
          stryCov_9fa48("741");
          this.nextStringIsKey = stryMutAct_9fa48("742") ? false : (stryCov_9fa48("742"), true);
          this.beginString(byteOffset);
        }
      } else if (stryMutAct_9fa48("745") ? ch !== "}" : stryMutAct_9fa48("744") ? false : stryMutAct_9fa48("743") ? true : (stryCov_9fa48("743", "744", "745"), ch === (stryMutAct_9fa48("746") ? "" : (stryCov_9fa48("746"), "}")))) {
        if (stryMutAct_9fa48("747")) {
          {}
        } else {
          stryCov_9fa48("747");
          // Empty object or trailing comma -> close
          this.emitToken(TokenType.ObjectEnd, stryMutAct_9fa48("748") ? "" : (stryCov_9fa48("748"), "}"), byteOffset, stryMutAct_9fa48("749") ? byteOffset - 1 : (stryCov_9fa48("749"), byteOffset + 1));
        }
      } else {
        if (stryMutAct_9fa48("750")) {
          {}
        } else {
          stryCov_9fa48("750");
          this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("751") ? "" : (stryCov_9fa48("751"), "error"), byteOffset, stryMutAct_9fa48("752") ? `` : (stryCov_9fa48("752"), `Expected object key (string) or '}', got: ${JSON.stringify(ch)}`), stryMutAct_9fa48("753") ? true : (stryCov_9fa48("753"), false));
          this.state = ScannerState.Invalid;
        }
      }
    }
  }
  private processString(ch: string, byteOffset: number, charByteLen: number): void {
    if (stryMutAct_9fa48("754")) {
      {}
    } else {
      stryCov_9fa48("754");
      if (stryMutAct_9fa48("757") ? ch !== "\\" : stryMutAct_9fa48("756") ? false : stryMutAct_9fa48("755") ? true : (stryCov_9fa48("755", "756", "757"), ch === (stryMutAct_9fa48("758") ? "" : (stryCov_9fa48("758"), "\\")))) {
        if (stryMutAct_9fa48("759")) {
          {}
        } else {
          stryCov_9fa48("759");
          this.state = ScannerState.Escape;
        }
      } else if (stryMutAct_9fa48("762") ? ch !== '"' : stryMutAct_9fa48("761") ? false : stryMutAct_9fa48("760") ? true : (stryCov_9fa48("760", "761", "762"), ch === (stryMutAct_9fa48("763") ? "" : (stryCov_9fa48("763"), '"')))) {
        if (stryMutAct_9fa48("764")) {
          {}
        } else {
          stryCov_9fa48("764");
          // String complete
          this.emitToken(TokenType.String, this.stringBuffer, this.stringByteStart, stryMutAct_9fa48("765") ? byteOffset - charByteLen : (stryCov_9fa48("765"), byteOffset + charByteLen));
          this.stringBuffer = stryMutAct_9fa48("766") ? "Stryker was here!" : (stryCov_9fa48("766"), "");
          this.state = ScannerState.Structural;
        }
      } else {
        if (stryMutAct_9fa48("767")) {
          {}
        } else {
          stryCov_9fa48("767");
          // Check for raw control characters
          const code = stryMutAct_9fa48("768") ? ch.codePointAt(0) && 0 : (stryCov_9fa48("768"), ch.codePointAt(0) ?? 0);
          if (stryMutAct_9fa48("772") ? code >= 0x20 : stryMutAct_9fa48("771") ? code <= 0x20 : stryMutAct_9fa48("770") ? false : stryMutAct_9fa48("769") ? true : (stryCov_9fa48("769", "770", "771", "772"), code < 0x20)) {
            if (stryMutAct_9fa48("773")) {
              {}
            } else {
              stryCov_9fa48("773");
              if (stryMutAct_9fa48("776") ? this.options.repairs?.rawControlCharacters !== "escape" : stryMutAct_9fa48("775") ? false : stryMutAct_9fa48("774") ? true : (stryCov_9fa48("774", "775", "776"), (stryMutAct_9fa48("777") ? this.options.repairs.rawControlCharacters : (stryCov_9fa48("777"), this.options.repairs?.rawControlCharacters)) === (stryMutAct_9fa48("778") ? "" : (stryCov_9fa48("778"), "escape")))) {
                if (stryMutAct_9fa48("779")) {
                  {}
                } else {
                  stryCov_9fa48("779");
                  stryMutAct_9fa48("780") ? this.stringBuffer -= ch : (stryCov_9fa48("780"), this.stringBuffer += ch); // Note: semantic character value preserved!
                  this.repairs.push(stryMutAct_9fa48("781") ? {} : (stryCov_9fa48("781"), {
                    code: stryMutAct_9fa48("782") ? "" : (stryCov_9fa48("782"), "R_ESCAPE_RAW_CONTROL"),
                    byteRange: stryMutAct_9fa48("783") ? [] : (stryCov_9fa48("783"), [byteOffset, stryMutAct_9fa48("784") ? byteOffset - charByteLen : (stryCov_9fa48("784"), byteOffset + charByteLen)]),
                    impact: stryMutAct_9fa48("785") ? "" : (stryCov_9fa48("785"), "representation_preserving"),
                    description: stryMutAct_9fa48("786") ? `` : (stryCov_9fa48("786"), `Escaped raw control character U+${code.toString(16).padStart(4, stryMutAct_9fa48("787") ? "" : (stryCov_9fa48("787"), "0"))}`)
                  }));
                }
              } else {
                if (stryMutAct_9fa48("788")) {
                  {}
                } else {
                  stryCov_9fa48("788");
                  this.emitDiagnostic(DiagnosticCode.W_RAW_CONTROL_CHARACTER, stryMutAct_9fa48("789") ? "" : (stryCov_9fa48("789"), "error"),
                  // Reject mode makes this an error
                  byteOffset, stryMutAct_9fa48("790") ? `` : (stryCov_9fa48("790"), `Raw control character U+${code.toString(16).padStart(4, stryMutAct_9fa48("791") ? "" : (stryCov_9fa48("791"), "0"))} in string`), stryMutAct_9fa48("792") ? true : (stryCov_9fa48("792"), false));
                  this.state = ScannerState.Invalid;
                  return;
                }
              }
            }
          } else {
            if (stryMutAct_9fa48("793")) {
              {}
            } else {
              stryCov_9fa48("793");
              stryMutAct_9fa48("794") ? this.stringBuffer -= ch : (stryCov_9fa48("794"), this.stringBuffer += ch);
            }
          }
        }
      }
    }
  }
  private processEscape(ch: string, byteOffset: number, _charByteLen: number): void {
    if (stryMutAct_9fa48("795")) {
      {}
    } else {
      stryCov_9fa48("795");
      switch (ch) {
        case stryMutAct_9fa48("796") ? "" : (stryCov_9fa48("796"), '"'):
        case stryMutAct_9fa48("797") ? "" : (stryCov_9fa48("797"), "\\"):
        case stryMutAct_9fa48("799") ? "" : (stryCov_9fa48("799"), "/"):
          if (stryMutAct_9fa48("798")) {} else {
            stryCov_9fa48("798");
            stryMutAct_9fa48("800") ? this.stringBuffer -= ch : (stryCov_9fa48("800"), this.stringBuffer += ch);
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("802") ? "" : (stryCov_9fa48("802"), "b"):
          if (stryMutAct_9fa48("801")) {} else {
            stryCov_9fa48("801");
            this.stringBuffer += stryMutAct_9fa48("803") ? "" : (stryCov_9fa48("803"), "\b");
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("805") ? "" : (stryCov_9fa48("805"), "f"):
          if (stryMutAct_9fa48("804")) {} else {
            stryCov_9fa48("804");
            this.stringBuffer += stryMutAct_9fa48("806") ? "" : (stryCov_9fa48("806"), "\f");
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("808") ? "" : (stryCov_9fa48("808"), "n"):
          if (stryMutAct_9fa48("807")) {} else {
            stryCov_9fa48("807");
            this.stringBuffer += stryMutAct_9fa48("809") ? "" : (stryCov_9fa48("809"), "\n");
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("811") ? "" : (stryCov_9fa48("811"), "r"):
          if (stryMutAct_9fa48("810")) {} else {
            stryCov_9fa48("810");
            this.stringBuffer += stryMutAct_9fa48("812") ? "" : (stryCov_9fa48("812"), "\r");
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("814") ? "" : (stryCov_9fa48("814"), "t"):
          if (stryMutAct_9fa48("813")) {} else {
            stryCov_9fa48("813");
            this.stringBuffer += stryMutAct_9fa48("815") ? "" : (stryCov_9fa48("815"), "\t");
            this.state = ScannerState.InString;
            break;
          }
        case stryMutAct_9fa48("817") ? "" : (stryCov_9fa48("817"), "u"):
          if (stryMutAct_9fa48("816")) {} else {
            stryCov_9fa48("816");
            this.unicodeHexBuffer = stryMutAct_9fa48("818") ? "Stryker was here!" : (stryCov_9fa48("818"), "");
            this.state = ScannerState.UnicodeEscape;
            break;
          }
        default:
          if (stryMutAct_9fa48("819")) {} else {
            stryCov_9fa48("819");
            this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("820") ? "" : (stryCov_9fa48("820"), "error"), byteOffset, stryMutAct_9fa48("821") ? `` : (stryCov_9fa48("821"), `Invalid escape sequence: \\${ch}`), stryMutAct_9fa48("822") ? true : (stryCov_9fa48("822"), false));
            this.state = ScannerState.Invalid;
            break;
          }
      }
    }
  }
  private processUnicodeEscape(ch: string, _byteOffset: number, _charByteLen: number): void {
    if (stryMutAct_9fa48("823")) {
      {}
    } else {
      stryCov_9fa48("823");
      if (stryMutAct_9fa48("825") ? false : stryMutAct_9fa48("824") ? true : (stryCov_9fa48("824", "825"), isHexDigit(ch))) {
        if (stryMutAct_9fa48("826")) {
          {}
        } else {
          stryCov_9fa48("826");
          stryMutAct_9fa48("827") ? this.unicodeHexBuffer -= ch : (stryCov_9fa48("827"), this.unicodeHexBuffer += ch);
          if (stryMutAct_9fa48("830") ? this.unicodeHexBuffer.length !== 4 : stryMutAct_9fa48("829") ? false : stryMutAct_9fa48("828") ? true : (stryCov_9fa48("828", "829", "830"), this.unicodeHexBuffer.length === 4)) {
            if (stryMutAct_9fa48("831")) {
              {}
            } else {
              stryCov_9fa48("831");
              const codeUnit = parseInt(this.unicodeHexBuffer, 16);
              if (stryMutAct_9fa48("834") ? this.highSurrogate === 0 : stryMutAct_9fa48("833") ? false : stryMutAct_9fa48("832") ? true : (stryCov_9fa48("832", "833", "834"), this.highSurrogate !== 0)) {
                if (stryMutAct_9fa48("835")) {
                  {}
                } else {
                  stryCov_9fa48("835");
                  // We expect a low surrogate
                  if (stryMutAct_9fa48("838") ? codeUnit >= 0xdc00 || codeUnit <= 0xdfff : stryMutAct_9fa48("837") ? false : stryMutAct_9fa48("836") ? true : (stryCov_9fa48("836", "837", "838"), (stryMutAct_9fa48("841") ? codeUnit < 0xdc00 : stryMutAct_9fa48("840") ? codeUnit > 0xdc00 : stryMutAct_9fa48("839") ? true : (stryCov_9fa48("839", "840", "841"), codeUnit >= 0xdc00)) && (stryMutAct_9fa48("844") ? codeUnit > 0xdfff : stryMutAct_9fa48("843") ? codeUnit < 0xdfff : stryMutAct_9fa48("842") ? true : (stryCov_9fa48("842", "843", "844"), codeUnit <= 0xdfff)))) {
                    if (stryMutAct_9fa48("845")) {
                      {}
                    } else {
                      stryCov_9fa48("845");
                      // Valid surrogate pair
                      const fullCodePoint = stryMutAct_9fa48("846") ? 0x10000 + (this.highSurrogate - 0xd800 << 10) - (codeUnit - 0xdc00) : (stryCov_9fa48("846"), (stryMutAct_9fa48("847") ? 0x10000 - (this.highSurrogate - 0xd800 << 10) : (stryCov_9fa48("847"), 0x10000 + ((stryMutAct_9fa48("848") ? this.highSurrogate + 0xd800 : (stryCov_9fa48("848"), this.highSurrogate - 0xd800)) << 10))) + (stryMutAct_9fa48("849") ? codeUnit + 0xdc00 : (stryCov_9fa48("849"), codeUnit - 0xdc00)));
                      stryMutAct_9fa48("850") ? this.stringBuffer -= String.fromCodePoint(fullCodePoint) : (stryCov_9fa48("850"), this.stringBuffer += String.fromCodePoint(fullCodePoint));
                      this.highSurrogate = 0;
                      this.state = ScannerState.InString;
                    }
                  } else {
                    if (stryMutAct_9fa48("851")) {
                      {}
                    } else {
                      stryCov_9fa48("851");
                      // Expected low surrogate, got something else
                      this.emitDiagnostic(DiagnosticCode.E_UNPAIRED_SURROGATE, stryMutAct_9fa48("852") ? "" : (stryCov_9fa48("852"), "error"), this.currentByteOffset, stryMutAct_9fa48("853") ? `` : (stryCov_9fa48("853"), `Expected low surrogate after \\u${this.highSurrogate.toString(16).padStart(4, stryMutAct_9fa48("854") ? "" : (stryCov_9fa48("854"), "0"))}, got \\u${this.unicodeHexBuffer}`), stryMutAct_9fa48("855") ? true : (stryCov_9fa48("855"), false));
                      this.highSurrogate = 0;
                      this.state = ScannerState.Invalid;
                    }
                  }
                }
              } else if (stryMutAct_9fa48("858") ? codeUnit >= 0xd800 || codeUnit <= 0xdbff : stryMutAct_9fa48("857") ? false : stryMutAct_9fa48("856") ? true : (stryCov_9fa48("856", "857", "858"), (stryMutAct_9fa48("861") ? codeUnit < 0xd800 : stryMutAct_9fa48("860") ? codeUnit > 0xd800 : stryMutAct_9fa48("859") ? true : (stryCov_9fa48("859", "860", "861"), codeUnit >= 0xd800)) && (stryMutAct_9fa48("864") ? codeUnit > 0xdbff : stryMutAct_9fa48("863") ? codeUnit < 0xdbff : stryMutAct_9fa48("862") ? true : (stryCov_9fa48("862", "863", "864"), codeUnit <= 0xdbff)))) {
                if (stryMutAct_9fa48("865")) {
                  {}
                } else {
                  stryCov_9fa48("865");
                  // High surrogate — need to see \uDC00-\uDFFF next
                  this.highSurrogate = codeUnit;
                  this.surrogatePhase = 0;
                  this.state = ScannerState.UnicodeSurrogatePending;
                }
              } else if (stryMutAct_9fa48("868") ? codeUnit >= 0xdc00 || codeUnit <= 0xdfff : stryMutAct_9fa48("867") ? false : stryMutAct_9fa48("866") ? true : (stryCov_9fa48("866", "867", "868"), (stryMutAct_9fa48("871") ? codeUnit < 0xdc00 : stryMutAct_9fa48("870") ? codeUnit > 0xdc00 : stryMutAct_9fa48("869") ? true : (stryCov_9fa48("869", "870", "871"), codeUnit >= 0xdc00)) && (stryMutAct_9fa48("874") ? codeUnit > 0xdfff : stryMutAct_9fa48("873") ? codeUnit < 0xdfff : stryMutAct_9fa48("872") ? true : (stryCov_9fa48("872", "873", "874"), codeUnit <= 0xdfff)))) {
                if (stryMutAct_9fa48("875")) {
                  {}
                } else {
                  stryCov_9fa48("875");
                  // Unexpected low surrogate without high
                  this.emitDiagnostic(DiagnosticCode.E_UNPAIRED_SURROGATE, stryMutAct_9fa48("876") ? "" : (stryCov_9fa48("876"), "error"), this.currentByteOffset, stryMutAct_9fa48("877") ? `` : (stryCov_9fa48("877"), `Unexpected low surrogate: \\u${this.unicodeHexBuffer}`), stryMutAct_9fa48("878") ? true : (stryCov_9fa48("878"), false));
                  this.state = ScannerState.Invalid;
                }
              } else {
                if (stryMutAct_9fa48("879")) {
                  {}
                } else {
                  stryCov_9fa48("879");
                  stryMutAct_9fa48("880") ? this.stringBuffer -= String.fromCharCode(codeUnit) : (stryCov_9fa48("880"), this.stringBuffer += String.fromCharCode(codeUnit));
                  this.state = ScannerState.InString;
                }
              }
              this.unicodeHexBuffer = stryMutAct_9fa48("881") ? "Stryker was here!" : (stryCov_9fa48("881"), "");
            }
          }
        }
      } else {
        if (stryMutAct_9fa48("882")) {
          {}
        } else {
          stryCov_9fa48("882");
          this.emitDiagnostic(DiagnosticCode.E_INVALID_UNICODE_ESCAPE, stryMutAct_9fa48("883") ? "" : (stryCov_9fa48("883"), "error"), this.currentByteOffset, stryMutAct_9fa48("884") ? `` : (stryCov_9fa48("884"), `Invalid hex digit in unicode escape: ${ch}`), stryMutAct_9fa48("885") ? true : (stryCov_9fa48("885"), false));
          this.state = ScannerState.Invalid;
        }
      }
    }
  }
  private processSurrogatePending(ch: string, byteOffset: number, _charByteLen: number): void {
    if (stryMutAct_9fa48("886")) {
      {}
    } else {
      stryCov_9fa48("886");
      // Expecting \uDCxx sequence
      // surrogatePhase: 0 = expecting \, 1 = expecting u
      if (stryMutAct_9fa48("889") ? this.surrogatePhase !== 0 : stryMutAct_9fa48("888") ? false : stryMutAct_9fa48("887") ? true : (stryCov_9fa48("887", "888", "889"), this.surrogatePhase === 0)) {
        if (stryMutAct_9fa48("890")) {
          {}
        } else {
          stryCov_9fa48("890");
          if (stryMutAct_9fa48("893") ? ch !== "\\" : stryMutAct_9fa48("892") ? false : stryMutAct_9fa48("891") ? true : (stryCov_9fa48("891", "892", "893"), ch === (stryMutAct_9fa48("894") ? "" : (stryCov_9fa48("894"), "\\")))) {
            if (stryMutAct_9fa48("895")) {
              {}
            } else {
              stryCov_9fa48("895");
              this.surrogatePhase = 1;
            }
          } else {
            if (stryMutAct_9fa48("896")) {
              {}
            } else {
              stryCov_9fa48("896");
              // Not a surrogate pair continuation — unpaired high surrogate
              this.emitDiagnostic(DiagnosticCode.E_UNPAIRED_SURROGATE, stryMutAct_9fa48("897") ? "" : (stryCov_9fa48("897"), "error"), byteOffset, stryMutAct_9fa48("898") ? `` : (stryCov_9fa48("898"), `Expected \\u for low surrogate, got: ${JSON.stringify(ch)}`), stryMutAct_9fa48("899") ? true : (stryCov_9fa48("899"), false));
              this.highSurrogate = 0;
              this.state = ScannerState.Invalid;
            }
          }
        }
      } else if (stryMutAct_9fa48("902") ? this.surrogatePhase !== 1 : stryMutAct_9fa48("901") ? false : stryMutAct_9fa48("900") ? true : (stryCov_9fa48("900", "901", "902"), this.surrogatePhase === 1)) {
        if (stryMutAct_9fa48("903")) {
          {}
        } else {
          stryCov_9fa48("903");
          if (stryMutAct_9fa48("906") ? ch !== "u" : stryMutAct_9fa48("905") ? false : stryMutAct_9fa48("904") ? true : (stryCov_9fa48("904", "905", "906"), ch === (stryMutAct_9fa48("907") ? "" : (stryCov_9fa48("907"), "u")))) {
            if (stryMutAct_9fa48("908")) {
              {}
            } else {
              stryCov_9fa48("908");
              this.unicodeHexBuffer = stryMutAct_9fa48("909") ? "Stryker was here!" : (stryCov_9fa48("909"), "");
              this.surrogatePhase = 0;
              this.state = ScannerState.UnicodeEscape;
            }
          } else {
            if (stryMutAct_9fa48("910")) {
              {}
            } else {
              stryCov_9fa48("910");
              this.emitDiagnostic(DiagnosticCode.E_UNPAIRED_SURROGATE, stryMutAct_9fa48("911") ? "" : (stryCov_9fa48("911"), "error"), byteOffset, stryMutAct_9fa48("912") ? `` : (stryCov_9fa48("912"), `Expected 'u' after '\\' for low surrogate, got: ${JSON.stringify(ch)}`), stryMutAct_9fa48("913") ? true : (stryCov_9fa48("913"), false));
              this.highSurrogate = 0;
              this.state = ScannerState.Invalid;
            }
          }
        }
      }
    }
  }
  private processNumber(ch: string, byteOffset: number, charByteLen: number): void {
    if (stryMutAct_9fa48("914")) {
      {}
    } else {
      stryCov_9fa48("914");
      switch (this.state) {
        case ScannerState.NumberInteger:
          if (stryMutAct_9fa48("915")) {} else {
            stryCov_9fa48("915");
            if (stryMutAct_9fa48("917") ? false : stryMutAct_9fa48("916") ? true : (stryCov_9fa48("916", "917"), isDigit(ch))) {
              if (stryMutAct_9fa48("918")) {
                {}
              } else {
                stryCov_9fa48("918");
                stryMutAct_9fa48("919") ? this.numberBuffer -= ch : (stryCov_9fa48("919"), this.numberBuffer += ch);
                this.numberHasDigit = stryMutAct_9fa48("920") ? false : (stryCov_9fa48("920"), true);
              }
            } else if (stryMutAct_9fa48("923") ? ch === "." || this.numberHasDigit : stryMutAct_9fa48("922") ? false : stryMutAct_9fa48("921") ? true : (stryCov_9fa48("921", "922", "923"), (stryMutAct_9fa48("925") ? ch !== "." : stryMutAct_9fa48("924") ? true : (stryCov_9fa48("924", "925"), ch === (stryMutAct_9fa48("926") ? "" : (stryCov_9fa48("926"), ".")))) && this.numberHasDigit)) {
              if (stryMutAct_9fa48("927")) {
                {}
              } else {
                stryCov_9fa48("927");
                stryMutAct_9fa48("928") ? this.numberBuffer -= ch : (stryCov_9fa48("928"), this.numberBuffer += ch);
                this.state = ScannerState.NumberFraction;
              }
            } else if (stryMutAct_9fa48("931") ? ch === "e" || ch === "E" || this.numberHasDigit : stryMutAct_9fa48("930") ? false : stryMutAct_9fa48("929") ? true : (stryCov_9fa48("929", "930", "931"), (stryMutAct_9fa48("933") ? ch === "e" && ch === "E" : stryMutAct_9fa48("932") ? true : (stryCov_9fa48("932", "933"), (stryMutAct_9fa48("935") ? ch !== "e" : stryMutAct_9fa48("934") ? false : (stryCov_9fa48("934", "935"), ch === (stryMutAct_9fa48("936") ? "" : (stryCov_9fa48("936"), "e")))) || (stryMutAct_9fa48("938") ? ch !== "E" : stryMutAct_9fa48("937") ? false : (stryCov_9fa48("937", "938"), ch === (stryMutAct_9fa48("939") ? "" : (stryCov_9fa48("939"), "E")))))) && this.numberHasDigit)) {
              if (stryMutAct_9fa48("940")) {
                {}
              } else {
                stryCov_9fa48("940");
                stryMutAct_9fa48("941") ? this.numberBuffer -= ch : (stryCov_9fa48("941"), this.numberBuffer += ch);
                this.state = ScannerState.NumberExponentStart;
              }
            } else if (stryMutAct_9fa48("944") ? this.numberHasDigit || this.isValueTerminator(ch) : stryMutAct_9fa48("943") ? false : stryMutAct_9fa48("942") ? true : (stryCov_9fa48("942", "943", "944"), this.numberHasDigit && this.isValueTerminator(ch))) {
              if (stryMutAct_9fa48("945")) {
                {}
              } else {
                stryCov_9fa48("945");
                this.commitNumber(byteOffset);
                this.reprocessChar(ch, byteOffset, charByteLen);
              }
            } else {
              if (stryMutAct_9fa48("946")) {
                {}
              } else {
                stryCov_9fa48("946");
                this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("947") ? "" : (stryCov_9fa48("947"), "error"), byteOffset, stryMutAct_9fa48("948") ? `` : (stryCov_9fa48("948"), `Invalid character in number: ${JSON.stringify(ch)}`), stryMutAct_9fa48("949") ? true : (stryCov_9fa48("949"), false));
                this.state = ScannerState.Invalid;
              }
            }
            break;
          }
        case ScannerState.NumberFraction:
          if (stryMutAct_9fa48("950")) {} else {
            stryCov_9fa48("950");
            if (stryMutAct_9fa48("952") ? false : stryMutAct_9fa48("951") ? true : (stryCov_9fa48("951", "952"), isDigit(ch))) {
              if (stryMutAct_9fa48("953")) {
                {}
              } else {
                stryCov_9fa48("953");
                stryMutAct_9fa48("954") ? this.numberBuffer -= ch : (stryCov_9fa48("954"), this.numberBuffer += ch);
              }
            } else if (stryMutAct_9fa48("957") ? ch === "e" && ch === "E" : stryMutAct_9fa48("956") ? false : stryMutAct_9fa48("955") ? true : (stryCov_9fa48("955", "956", "957"), (stryMutAct_9fa48("959") ? ch !== "e" : stryMutAct_9fa48("958") ? false : (stryCov_9fa48("958", "959"), ch === (stryMutAct_9fa48("960") ? "" : (stryCov_9fa48("960"), "e")))) || (stryMutAct_9fa48("962") ? ch !== "E" : stryMutAct_9fa48("961") ? false : (stryCov_9fa48("961", "962"), ch === (stryMutAct_9fa48("963") ? "" : (stryCov_9fa48("963"), "E")))))) {
              if (stryMutAct_9fa48("964")) {
                {}
              } else {
                stryCov_9fa48("964");
                stryMutAct_9fa48("965") ? this.numberBuffer -= ch : (stryCov_9fa48("965"), this.numberBuffer += ch);
                this.state = ScannerState.NumberExponentStart;
              }
            } else if (stryMutAct_9fa48("967") ? false : stryMutAct_9fa48("966") ? true : (stryCov_9fa48("966", "967"), this.isValueTerminator(ch))) {
              if (stryMutAct_9fa48("968")) {
                {}
              } else {
                stryCov_9fa48("968");
                // Validate that we have at least one fraction digit
                const lastChar = this.numberBuffer[stryMutAct_9fa48("969") ? this.numberBuffer.length + 1 : (stryCov_9fa48("969"), this.numberBuffer.length - 1)];
                if (stryMutAct_9fa48("972") ? lastChar !== "." : stryMutAct_9fa48("971") ? false : stryMutAct_9fa48("970") ? true : (stryCov_9fa48("970", "971", "972"), lastChar === (stryMutAct_9fa48("973") ? "" : (stryCov_9fa48("973"), ".")))) {
                  if (stryMutAct_9fa48("974")) {
                    {}
                  } else {
                    stryCov_9fa48("974");
                    this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("975") ? "" : (stryCov_9fa48("975"), "error"), byteOffset, stryMutAct_9fa48("976") ? "" : (stryCov_9fa48("976"), "Number has trailing decimal point with no digits"), stryMutAct_9fa48("977") ? true : (stryCov_9fa48("977"), false));
                    this.state = ScannerState.Invalid;
                  }
                } else {
                  if (stryMutAct_9fa48("978")) {
                    {}
                  } else {
                    stryCov_9fa48("978");
                    this.commitNumber(byteOffset);
                    this.reprocessChar(ch, byteOffset, charByteLen);
                  }
                }
              }
            } else {
              if (stryMutAct_9fa48("979")) {
                {}
              } else {
                stryCov_9fa48("979");
                this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("980") ? "" : (stryCov_9fa48("980"), "error"), byteOffset, stryMutAct_9fa48("981") ? `` : (stryCov_9fa48("981"), `Invalid character in number fraction: ${JSON.stringify(ch)}`), stryMutAct_9fa48("982") ? true : (stryCov_9fa48("982"), false));
                this.state = ScannerState.Invalid;
              }
            }
            break;
          }
        case ScannerState.NumberExponentStart:
          if (stryMutAct_9fa48("983")) {} else {
            stryCov_9fa48("983");
            if (stryMutAct_9fa48("985") ? false : stryMutAct_9fa48("984") ? true : (stryCov_9fa48("984", "985"), isDigit(ch))) {
              if (stryMutAct_9fa48("986")) {
                {}
              } else {
                stryCov_9fa48("986");
                stryMutAct_9fa48("987") ? this.numberBuffer -= ch : (stryCov_9fa48("987"), this.numberBuffer += ch);
                this.state = ScannerState.NumberExponent;
              }
            } else if (stryMutAct_9fa48("990") ? ch === "+" && ch === "-" : stryMutAct_9fa48("989") ? false : stryMutAct_9fa48("988") ? true : (stryCov_9fa48("988", "989", "990"), (stryMutAct_9fa48("992") ? ch !== "+" : stryMutAct_9fa48("991") ? false : (stryCov_9fa48("991", "992"), ch === (stryMutAct_9fa48("993") ? "" : (stryCov_9fa48("993"), "+")))) || (stryMutAct_9fa48("995") ? ch !== "-" : stryMutAct_9fa48("994") ? false : (stryCov_9fa48("994", "995"), ch === (stryMutAct_9fa48("996") ? "" : (stryCov_9fa48("996"), "-")))))) {
              if (stryMutAct_9fa48("997")) {
                {}
              } else {
                stryCov_9fa48("997");
                stryMutAct_9fa48("998") ? this.numberBuffer -= ch : (stryCov_9fa48("998"), this.numberBuffer += ch);
                this.state = ScannerState.NumberExponent;
              }
            } else {
              if (stryMutAct_9fa48("999")) {
                {}
              } else {
                stryCov_9fa48("999");
                this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1000") ? "" : (stryCov_9fa48("1000"), "error"), byteOffset, stryMutAct_9fa48("1001") ? `` : (stryCov_9fa48("1001"), `Expected digit or sign after exponent, got: ${JSON.stringify(ch)}`), stryMutAct_9fa48("1002") ? true : (stryCov_9fa48("1002"), false));
                this.state = ScannerState.Invalid;
              }
            }
            break;
          }
        case ScannerState.NumberExponent:
          if (stryMutAct_9fa48("1003")) {} else {
            stryCov_9fa48("1003");
            if (stryMutAct_9fa48("1005") ? false : stryMutAct_9fa48("1004") ? true : (stryCov_9fa48("1004", "1005"), isDigit(ch))) {
              if (stryMutAct_9fa48("1006")) {
                {}
              } else {
                stryCov_9fa48("1006");
                stryMutAct_9fa48("1007") ? this.numberBuffer -= ch : (stryCov_9fa48("1007"), this.numberBuffer += ch);
              }
            } else if (stryMutAct_9fa48("1009") ? false : stryMutAct_9fa48("1008") ? true : (stryCov_9fa48("1008", "1009"), this.isValueTerminator(ch))) {
              if (stryMutAct_9fa48("1010")) {
                {}
              } else {
                stryCov_9fa48("1010");
                // Validate we have at least one exponent digit
                const last = this.numberBuffer[stryMutAct_9fa48("1011") ? this.numberBuffer.length + 1 : (stryCov_9fa48("1011"), this.numberBuffer.length - 1)];
                if (stryMutAct_9fa48("1014") ? (last === "+" || last === "-" || last === "e") && last === "E" : stryMutAct_9fa48("1013") ? false : stryMutAct_9fa48("1012") ? true : (stryCov_9fa48("1012", "1013", "1014"), (stryMutAct_9fa48("1016") ? (last === "+" || last === "-") && last === "e" : stryMutAct_9fa48("1015") ? false : (stryCov_9fa48("1015", "1016"), (stryMutAct_9fa48("1018") ? last === "+" && last === "-" : stryMutAct_9fa48("1017") ? false : (stryCov_9fa48("1017", "1018"), (stryMutAct_9fa48("1020") ? last !== "+" : stryMutAct_9fa48("1019") ? false : (stryCov_9fa48("1019", "1020"), last === (stryMutAct_9fa48("1021") ? "" : (stryCov_9fa48("1021"), "+")))) || (stryMutAct_9fa48("1023") ? last !== "-" : stryMutAct_9fa48("1022") ? false : (stryCov_9fa48("1022", "1023"), last === (stryMutAct_9fa48("1024") ? "" : (stryCov_9fa48("1024"), "-")))))) || (stryMutAct_9fa48("1026") ? last !== "e" : stryMutAct_9fa48("1025") ? false : (stryCov_9fa48("1025", "1026"), last === (stryMutAct_9fa48("1027") ? "" : (stryCov_9fa48("1027"), "e")))))) || (stryMutAct_9fa48("1029") ? last !== "E" : stryMutAct_9fa48("1028") ? false : (stryCov_9fa48("1028", "1029"), last === (stryMutAct_9fa48("1030") ? "" : (stryCov_9fa48("1030"), "E")))))) {
                  if (stryMutAct_9fa48("1031")) {
                    {}
                  } else {
                    stryCov_9fa48("1031");
                    this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1032") ? "" : (stryCov_9fa48("1032"), "error"), byteOffset, stryMutAct_9fa48("1033") ? "" : (stryCov_9fa48("1033"), "Number has exponent with no digits"), stryMutAct_9fa48("1034") ? true : (stryCov_9fa48("1034"), false));
                    this.state = ScannerState.Invalid;
                  }
                } else {
                  if (stryMutAct_9fa48("1035")) {
                    {}
                  } else {
                    stryCov_9fa48("1035");
                    this.commitNumber(byteOffset);
                    this.reprocessChar(ch, byteOffset, charByteLen);
                  }
                }
              }
            } else {
              if (stryMutAct_9fa48("1036")) {
                {}
              } else {
                stryCov_9fa48("1036");
                this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1037") ? "" : (stryCov_9fa48("1037"), "error"), byteOffset, stryMutAct_9fa48("1038") ? `` : (stryCov_9fa48("1038"), `Invalid character in number exponent: ${JSON.stringify(ch)}`), stryMutAct_9fa48("1039") ? true : (stryCov_9fa48("1039"), false));
                this.state = ScannerState.Invalid;
              }
            }
            break;
          }
      }
    }
  }
  private processLiteral(ch: string, byteOffset: number, charByteLen: number): void {
    if (stryMutAct_9fa48("1040")) {
      {}
    } else {
      stryCov_9fa48("1040");
      const expected = this.literalTarget[this.literalIndex];
      if (stryMutAct_9fa48("1043") ? ch !== expected : stryMutAct_9fa48("1042") ? false : stryMutAct_9fa48("1041") ? true : (stryCov_9fa48("1041", "1042", "1043"), ch === expected)) {
        if (stryMutAct_9fa48("1044")) {
          {}
        } else {
          stryCov_9fa48("1044");
          stryMutAct_9fa48("1045") ? this.literalIndex-- : (stryCov_9fa48("1045"), this.literalIndex++);
          if (stryMutAct_9fa48("1048") ? this.literalIndex !== this.literalTarget.length : stryMutAct_9fa48("1047") ? false : stryMutAct_9fa48("1046") ? true : (stryCov_9fa48("1046", "1047", "1048"), this.literalIndex === this.literalTarget.length)) {
            // Literal is fully matched, but we can't emit until we see a terminator.
            // Stay in the literal state — the next character will either be a terminator
            // or invalid. We handle this by checking if we've reached the full length
            // in the next call.
            // Actually, we need to wait for a terminator to commit the literal,
            // similar to numbers. Let's transition to a "literal complete, awaiting terminator" state.
            // For simplicity, we'll check on the next character.
          }
        }
      } else if (stryMutAct_9fa48("1051") ? this.literalIndex !== this.literalTarget.length : stryMutAct_9fa48("1050") ? false : stryMutAct_9fa48("1049") ? true : (stryCov_9fa48("1049", "1050", "1051"), this.literalIndex === this.literalTarget.length)) {
        if (stryMutAct_9fa48("1052")) {
          {}
        } else {
          stryCov_9fa48("1052");
          // Literal was fully matched — this character is the terminator
          if (stryMutAct_9fa48("1054") ? false : stryMutAct_9fa48("1053") ? true : (stryCov_9fa48("1053", "1054"), this.isValueTerminator(ch))) {
            if (stryMutAct_9fa48("1055")) {
              {}
            } else {
              stryCov_9fa48("1055");
              const type = (stryMutAct_9fa48("1058") ? this.literalTarget !== "true" : stryMutAct_9fa48("1057") ? false : stryMutAct_9fa48("1056") ? true : (stryCov_9fa48("1056", "1057", "1058"), this.literalTarget === (stryMutAct_9fa48("1059") ? "" : (stryCov_9fa48("1059"), "true")))) ? TokenType.True : (stryMutAct_9fa48("1062") ? this.literalTarget !== "false" : stryMutAct_9fa48("1061") ? false : stryMutAct_9fa48("1060") ? true : (stryCov_9fa48("1060", "1061", "1062"), this.literalTarget === (stryMutAct_9fa48("1063") ? "" : (stryCov_9fa48("1063"), "false")))) ? TokenType.False : TokenType.Null;
              this.emitToken(type, this.literalTarget, this.literalByteStart, byteOffset);
              this.state = ScannerState.Structural;
              this.reprocessChar(ch, byteOffset, charByteLen);
            }
          } else {
            if (stryMutAct_9fa48("1064")) {
              {}
            } else {
              stryCov_9fa48("1064");
              this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1065") ? "" : (stryCov_9fa48("1065"), "error"), byteOffset, stryMutAct_9fa48("1066") ? `` : (stryCov_9fa48("1066"), `Expected value terminator after '${this.literalTarget}', got: ${JSON.stringify(ch)}`), stryMutAct_9fa48("1067") ? true : (stryCov_9fa48("1067"), false));
              this.state = ScannerState.Invalid;
            }
          }
        }
      } else {
        if (stryMutAct_9fa48("1068")) {
          {}
        } else {
          stryCov_9fa48("1068");
          this.emitDiagnostic(DiagnosticCode.E_UNEXPECTED_TOKEN, stryMutAct_9fa48("1069") ? "" : (stryCov_9fa48("1069"), "error"), byteOffset, stryMutAct_9fa48("1070") ? `` : (stryCov_9fa48("1070"), `Invalid literal: expected '${this.literalTarget[this.literalIndex]}' but got '${ch}' (parsing '${this.literalTarget}')`), stryMutAct_9fa48("1071") ? true : (stryCov_9fa48("1071"), false));
          this.state = ScannerState.Invalid;
        }
      }
    }
  }
  private processTrailingWhitespace(ch: string, byteOffset: number): void {
    if (stryMutAct_9fa48("1072")) {
      {}
    } else {
      stryCov_9fa48("1072");
      if (stryMutAct_9fa48("1074") ? false : stryMutAct_9fa48("1073") ? true : (stryCov_9fa48("1073", "1074"), isWhitespace(ch))) return;

      // Non-whitespace after root value
      this.emitDiagnostic(DiagnosticCode.E_TRAILING_DATA, stryMutAct_9fa48("1075") ? "" : (stryCov_9fa48("1075"), "error"), byteOffset, stryMutAct_9fa48("1076") ? `` : (stryCov_9fa48("1076"), `Unexpected data after root JSON value: ${JSON.stringify(ch)}`), stryMutAct_9fa48("1077") ? true : (stryCov_9fa48("1077"), false));
      this.state = ScannerState.TrailingData;
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private beginString(byteOffset: number): void {
    if (stryMutAct_9fa48("1078")) {
      {}
    } else {
      stryCov_9fa48("1078");
      this.stringBuffer = stryMutAct_9fa48("1079") ? "Stryker was here!" : (stryCov_9fa48("1079"), "");
      this.stringByteStart = byteOffset;
      this.stringIsKey = this.nextStringIsKey;
      this.nextStringIsKey = stryMutAct_9fa48("1080") ? true : (stryCov_9fa48("1080"), false);
      this.highSurrogate = 0;
      this.state = ScannerState.InString;
    }
  }
  private beginNumber(firstChar: string, byteOffset: number): void {
    if (stryMutAct_9fa48("1081")) {
      {}
    } else {
      stryCov_9fa48("1081");
      this.numberBuffer = firstChar;
      this.numberByteStart = byteOffset;
      this.numberHasDigit = stryMutAct_9fa48("1084") ? firstChar === "-" : stryMutAct_9fa48("1083") ? false : stryMutAct_9fa48("1082") ? true : (stryCov_9fa48("1082", "1083", "1084"), firstChar !== (stryMutAct_9fa48("1085") ? "" : (stryCov_9fa48("1085"), "-")));
      this.state = ScannerState.NumberInteger;
    }
  }
  private beginLiteral(target: string, byteOffset: number): void {
    if (stryMutAct_9fa48("1086")) {
      {}
    } else {
      stryCov_9fa48("1086");
      this.literalTarget = target;
      this.literalIndex = 1; // first char already matched
      this.literalByteStart = byteOffset;
      if (stryMutAct_9fa48("1089") ? target !== "true" : stryMutAct_9fa48("1088") ? false : stryMutAct_9fa48("1087") ? true : (stryCov_9fa48("1087", "1088", "1089"), target === (stryMutAct_9fa48("1090") ? "" : (stryCov_9fa48("1090"), "true")))) {
        if (stryMutAct_9fa48("1091")) {
          {}
        } else {
          stryCov_9fa48("1091");
          this.state = ScannerState.LiteralTrue;
        }
      } else if (stryMutAct_9fa48("1094") ? target !== "false" : stryMutAct_9fa48("1093") ? false : stryMutAct_9fa48("1092") ? true : (stryCov_9fa48("1092", "1093", "1094"), target === (stryMutAct_9fa48("1095") ? "" : (stryCov_9fa48("1095"), "false")))) {
        if (stryMutAct_9fa48("1096")) {
          {}
        } else {
          stryCov_9fa48("1096");
          this.state = ScannerState.LiteralFalse;
        }
      } else {
        if (stryMutAct_9fa48("1097")) {
          {}
        } else {
          stryCov_9fa48("1097");
          this.state = ScannerState.LiteralNull;
        }
      }
    }
  }
  private commitNumber(endByteOffset: number): void {
    if (stryMutAct_9fa48("1098")) {
      {}
    } else {
      stryCov_9fa48("1098");
      this.emitToken(TokenType.Number, this.numberBuffer, this.numberByteStart, endByteOffset);
      this.numberBuffer = stryMutAct_9fa48("1099") ? "Stryker was here!" : (stryCov_9fa48("1099"), "");
      this.state = ScannerState.Structural;
    }
  }
  private isValueTerminator(ch: string): boolean {
    if (stryMutAct_9fa48("1100")) {
      {}
    } else {
      stryCov_9fa48("1100");
      return stryMutAct_9fa48("1103") ? (isWhitespace(ch) || ch === "," || ch === "}" || ch === "]") && ch === ":" : stryMutAct_9fa48("1102") ? false : stryMutAct_9fa48("1101") ? true : (stryCov_9fa48("1101", "1102", "1103"), (stryMutAct_9fa48("1105") ? (isWhitespace(ch) || ch === "," || ch === "}") && ch === "]" : stryMutAct_9fa48("1104") ? false : (stryCov_9fa48("1104", "1105"), (stryMutAct_9fa48("1107") ? (isWhitespace(ch) || ch === ",") && ch === "}" : stryMutAct_9fa48("1106") ? false : (stryCov_9fa48("1106", "1107"), (stryMutAct_9fa48("1109") ? isWhitespace(ch) && ch === "," : stryMutAct_9fa48("1108") ? false : (stryCov_9fa48("1108", "1109"), isWhitespace(ch) || (stryMutAct_9fa48("1111") ? ch !== "," : stryMutAct_9fa48("1110") ? false : (stryCov_9fa48("1110", "1111"), ch === (stryMutAct_9fa48("1112") ? "" : (stryCov_9fa48("1112"), ",")))))) || (stryMutAct_9fa48("1114") ? ch !== "}" : stryMutAct_9fa48("1113") ? false : (stryCov_9fa48("1113", "1114"), ch === (stryMutAct_9fa48("1115") ? "" : (stryCov_9fa48("1115"), "}")))))) || (stryMutAct_9fa48("1117") ? ch !== "]" : stryMutAct_9fa48("1116") ? false : (stryCov_9fa48("1116", "1117"), ch === (stryMutAct_9fa48("1118") ? "" : (stryCov_9fa48("1118"), "]")))))) || (stryMutAct_9fa48("1120") ? ch !== ":" : stryMutAct_9fa48("1119") ? false : (stryCov_9fa48("1119", "1120"), ch === (stryMutAct_9fa48("1121") ? "" : (stryCov_9fa48("1121"), ":")))));
    }
  }
  private reprocessChar(ch: string, byteOffset: number, charByteLen: number): void {
    if (stryMutAct_9fa48("1122")) {
      {}
    } else {
      stryCov_9fa48("1122");
      // After committing a number/literal, state has been set to Structural.
      // Reprocess the terminating character in the new state.
      this.feedChar(ch, byteOffset, charByteLen);
    }
  }
  private emitToken(type: TokenType, value: string, byteStart: number, byteEnd: number): void {
    if (stryMutAct_9fa48("1123")) {
      {}
    } else {
      stryCov_9fa48("1123");
      this.tokens.push(stryMutAct_9fa48("1124") ? {} : (stryCov_9fa48("1124"), {
        type,
        value,
        byteStart,
        byteEnd
      }));
    }
  }
  private emitDiagnostic(code: string, severity: "info" | "warning" | "error" | "fatal", byteOffset: number, message: string, recoverable: boolean): void {
    if (stryMutAct_9fa48("1125")) {
      {}
    } else {
      stryCov_9fa48("1125");
      this.diagnostics.push(createDiagnostic(code, severity, byteOffset, message, recoverable));
    }
  }
}