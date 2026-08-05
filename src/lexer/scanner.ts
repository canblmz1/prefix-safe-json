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

import { ScannerState } from "./states.js";
import { TokenType } from "./tokens.js";
import type { Token } from "./tokens.js";
import type { Diagnostic, RepairAction, ParserOptions } from "../types.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/factory.js";
import { DEFAULT_LIMITS, sanitizeLimit } from "../limits.js";

/** Whitespace characters in JSON. */
function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isHexDigit(ch: string): boolean {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "a" && ch <= "f") ||
    (ch >= "A" && ch <= "F")
  );
}

/**
 * Incremental JSON scanner.
 * Feed characters one at a time via feedChar().
 * Collect tokens via takeTokens().
 */
export class Scanner {
  private options: ParserOptions;
  private maxStringBytes: number;

  constructor(options?: ParserOptions) {
    this.options = options ?? {};
    this.maxStringBytes = sanitizeLimit(
      options?.limits?.maxStringBytes,
      DEFAULT_LIMITS.maxStringBytes,
    );
  }

  private state: ScannerState = ScannerState.Structural;
  private tokens: Token[] = [];
  private diagnostics: Diagnostic[] = [];
  private repairs: RepairAction[] = [];

  // --- String state ---
  private stringBuffer = "";
  private stringIsKey = false;
  private stringByteStart = 0;

  // --- Unicode escape state ---
  private unicodeHexBuffer = "";
  private highSurrogate = 0;
  /** Tracks position in surrogate pair sequence: 0=initial, 1=saw backslash, 2=saw 'u' */
  private surrogatePhase = 0;

  // --- Number state ---
  private numberBuffer = "";
  private numberByteStart = 0;
  private numberHasDigit = false;

  // --- Literal state ---
  private literalTarget = "";
  private literalIndex = 0;
  private literalByteStart = 0;

  // --- Byte offset tracking ---
  /** Byte offset of the current character being fed. Set by the caller. */
  private currentByteOffset = 0;

  // --- Depth tracking for string context ---
  /** Whether we're in a key position for string parsing. */
  private nextStringIsKey = false;

  get currentState(): ScannerState {
    return this.state;
  }

  /**
   * Feed a single character to the scanner.
   * @param ch - The character to process.
   * @param byteOffset - Absolute byte offset of this character in the input stream.
   * @param charByteLength - Number of bytes this character occupies in UTF-8.
   */
  feedChar(ch: string, byteOffset: number, charByteLength: number): void {
    this.currentByteOffset = byteOffset;

    switch (this.state) {
      case ScannerState.Structural:
        this.processStructural(ch, byteOffset, charByteLength);
        break;
      case ScannerState.ObjectKey:
        this.processObjectKey(ch, byteOffset);
        break;
      case ScannerState.InString:
        this.processString(ch, byteOffset, charByteLength);
        break;
      case ScannerState.Escape:
        this.processEscape(ch, byteOffset, charByteLength);
        break;
      case ScannerState.UnicodeEscape:
        this.processUnicodeEscape(ch, byteOffset, charByteLength);
        break;
      case ScannerState.UnicodeSurrogatePending:
        this.processSurrogatePending(ch, byteOffset, charByteLength);
        break;
      case ScannerState.NumberInteger:
      case ScannerState.NumberFraction:
      case ScannerState.NumberExponentStart:
      case ScannerState.NumberExponent:
        this.processNumber(ch, byteOffset, charByteLength);
        break;
      case ScannerState.LiteralTrue:
      case ScannerState.LiteralFalse:
      case ScannerState.LiteralNull:
        this.processLiteral(ch, byteOffset, charByteLength);
        break;
      case ScannerState.TrailingWhitespace:
        this.processTrailingWhitespace(ch, byteOffset);
        break;
      case ScannerState.TrailingData:
        // Consume all trailing data silently — diagnostic was already emitted
        break;
      case ScannerState.Invalid:
      case ScannerState.Finished:
        // No-op — terminal states
        break;
    }
  }

  /**
   * Take all tokens accumulated since the last call.
   * Clears the internal token buffer.
   */
  takeTokens(): Token[] {
    const result = this.tokens;
    this.tokens = [];
    return result;
  }

  /**
   * Take all diagnostics accumulated since the last call.
   * Clears the internal diagnostic buffer.
   */
  takeDiagnostics(): Diagnostic[] {
    const result = this.diagnostics;
    this.diagnostics = [];
    return result;
  }

  takeRepairs(): RepairAction[] {
    const result = this.repairs;
    this.repairs = [];
    return result;
  }

  /**
   * Set whether the next string to be scanned should be treated as an object key.
   */
  setNextStringIsKey(isKey: boolean): void {
    this.nextStringIsKey = isKey;
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
    switch (this.state) {
      case ScannerState.InString:
      case ScannerState.Escape:
        return {
          type: this.stringIsKey ? "object_key" as "string" : "string",
          buffer: this.stringBuffer,
          byteStart: this.stringByteStart,
          isKey: this.stringIsKey,
        };
      case ScannerState.UnicodeEscape:
        return {
          type: "unicode_escape",
          buffer: this.unicodeHexBuffer,
          byteStart: this.stringByteStart,
          isKey: this.stringIsKey,
        };
      case ScannerState.UnicodeSurrogatePending:
        return {
          type: "surrogate",
          buffer: this.stringBuffer,
          byteStart: this.stringByteStart,
          isKey: this.stringIsKey,
        };
      case ScannerState.NumberInteger:
      case ScannerState.NumberFraction:
      case ScannerState.NumberExponentStart:
      case ScannerState.NumberExponent:
        return {
          type: "number",
          buffer: this.numberBuffer,
          byteStart: this.numberByteStart,
          isKey: false,
        };
      case ScannerState.LiteralTrue:
      case ScannerState.LiteralFalse:
      case ScannerState.LiteralNull:
        return {
          type: "literal",
          buffer: this.literalTarget.slice(0, this.literalIndex),
          byteStart: this.literalByteStart,
          isKey: false,
        };
      default:
        return { type: "none", buffer: "", byteStart: 0, isKey: false };
    }
  }

  /**
   * Check numberBuffer against the parts of RFC 8259's number grammar that
   * aren't already enforced by the state machine's character-by-character
   * transitions: no leading zero in the integer part, and no trailing
   * "." or exponent marker with no digit following it. Returns an error
   * message if invalid, or null if the buffer is a well-formed number.
   */
  private numberGrammarError(): string | null {
    const buf = this.numberBuffer;
    const last = buf[buf.length - 1];

    if (last === ".") {
      return "Number has trailing decimal point with no digits";
    }
    if (last === "e" || last === "E" || last === "+" || last === "-") {
      return "Number has exponent with no digits";
    }

    const unsigned = buf[0] === "-" ? buf.slice(1) : buf;
    let intPart = "";
    for (const c of unsigned) {
      if (c >= "0" && c <= "9") {
        intPart += c;
      } else {
        break;
      }
    }
    if (intPart.length > 1 && intPart[0] === "0") {
      return "Number has leading zero";
    }

    return null;
  }

  /**
   * Attempt to finalize a pending number (at end of input or finish()).
   *  - "finalized": a valid number token was emitted.
   *  - "invalid": there was a complete-looking buffer, but it violates JSON
   *    number grammar (leading zero, trailing "." or exponent marker with
   *    no digit after it). Nothing is emitted; numberBuffer is left as-is.
   *  - "not_ready": scanner isn't in a finalizable number state at all
   *    (e.g. buffer is just "-", or ends right at a bare "e"/"E" with no
   *    sign or digit yet) — unchanged pre-existing behavior, callers should
   *    not newly diagnose this case.
   */
  finalizeNumber(): "finalized" | "invalid" | "not_ready" {
    if (
      this.state === ScannerState.NumberInteger ||
      this.state === ScannerState.NumberFraction ||
      this.state === ScannerState.NumberExponent
    ) {
      if (this.numberHasDigit) {
        if (this.numberGrammarError() !== null) {
          return "invalid";
        }
        this.emitToken(
          TokenType.Number,
          this.numberBuffer,
          this.numberByteStart,
          this.currentByteOffset + 1,
        );
        this.state = ScannerState.TrailingWhitespace;
        return "finalized";
      }
    }
    return "not_ready";
  }

  /**
   * Attempt to finalize a pending literal (at end of input or finish).
   * Returns true if a literal token was emitted.
   */
  finalizeLiteral(): boolean {
    if (
      this.state === ScannerState.LiteralTrue ||
      this.state === ScannerState.LiteralFalse ||
      this.state === ScannerState.LiteralNull
    ) {
      if (this.literalIndex === this.literalTarget.length) {
        const type =
          this.literalTarget === "true"
            ? TokenType.True
            : this.literalTarget === "false"
              ? TokenType.False
              : TokenType.Null;
        this.emitToken(
          type,
          this.literalTarget,
          this.literalByteStart,
          this.currentByteOffset + 1,
        );
        this.state = ScannerState.TrailingWhitespace;
        return true;
      }
    }
    return false;
  }

  // -----------------------------------------------------------------------
  // State handlers
  // -----------------------------------------------------------------------

  private processStructural(ch: string, byteOffset: number, charByteLen: number): void {
    if (isWhitespace(ch)) return;

    if (ch === "{") {
      this.emitToken(TokenType.ObjectStart, "{", byteOffset, byteOffset + charByteLen);
      this.state = ScannerState.Structural;
    } else if (ch === "[") {
      this.emitToken(TokenType.ArrayStart, "[", byteOffset, byteOffset + charByteLen);
      this.state = ScannerState.Structural;
    } else if (ch === "}") {
      this.emitToken(TokenType.ObjectEnd, "}", byteOffset, byteOffset + charByteLen);
    } else if (ch === "]") {
      this.emitToken(TokenType.ArrayEnd, "]", byteOffset, byteOffset + charByteLen);
    } else if (ch === ",") {
      this.emitToken(TokenType.Comma, ",", byteOffset, byteOffset + charByteLen);
    } else if (ch === ":") {
      this.emitToken(TokenType.Colon, ":", byteOffset, byteOffset + charByteLen);
    } else if (ch === '"') {
      this.beginString(byteOffset);
    } else if (ch === "-" || isDigit(ch)) {
      this.beginNumber(ch, byteOffset);
    } else if (ch === "t") {
      this.beginLiteral("true", byteOffset);
    } else if (ch === "f") {
      this.beginLiteral("false", byteOffset);
    } else if (ch === "n") {
      this.beginLiteral("null", byteOffset);
    } else {
      this.emitDiagnostic(
        DiagnosticCode.E_UNEXPECTED_TOKEN,
        "error",
        byteOffset,
        `Unexpected character: ${JSON.stringify(ch)}`,
        false,
      );
      this.state = ScannerState.Invalid;
    }
  }

  private processObjectKey(ch: string, byteOffset: number): void {
    if (isWhitespace(ch)) return;

    if (ch === '"') {
      this.nextStringIsKey = true;
      this.beginString(byteOffset);
    } else if (ch === "}") {
      // Empty object or trailing comma -> close
      this.emitToken(TokenType.ObjectEnd, "}", byteOffset, byteOffset + 1);
    } else {
      this.emitDiagnostic(
        DiagnosticCode.E_UNEXPECTED_TOKEN,
        "error",
        byteOffset,
        `Expected object key (string) or '}', got: ${JSON.stringify(ch)}`,
        false,
      );
      this.state = ScannerState.Invalid;
    }
  }

  private processString(ch: string, byteOffset: number, charByteLen: number): void {
    // Checked for every character except the closing quote itself (checking
    // here rather than only at termination means a string that never closes
    // can't grow unboundedly before being caught; still checked on "\\" so
    // an all-escape-sequence string can't bypass it either, since escaped
    // characters are consumed by processEscape, not this function).
    // byteOffset - stringByteStart counts bytes from the *opening* quote, so
    // it equals the content length so far for any content character — but
    // for the closing quote specifically it equals content length + 1 (the
    // opening quote's own byte), which would wrongly reject a string of
    // exactly maxStringBytes. Excluding '"' here fixes that off-by-one.
    if (ch !== '"' && byteOffset - this.stringByteStart > this.maxStringBytes) {
      this.emitDiagnostic(
        DiagnosticCode.E_LIMIT_STRING_BYTES,
        "fatal",
        byteOffset,
        `String exceeds maximum of ${this.maxStringBytes} bytes`,
        false,
      );
      this.state = ScannerState.Invalid;
      return;
    }

    if (ch === "\\") {
      this.state = ScannerState.Escape;
    } else if (ch === '"') {
      // String complete
      this.emitToken(
        TokenType.String,
        this.stringBuffer,
        this.stringByteStart,
        byteOffset + charByteLen,
      );
      this.stringBuffer = "";
      this.state = ScannerState.Structural;
    } else {
      // Check for raw control characters
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x20) {
        if (this.options.repairs?.rawControlCharacters === "escape") {

          this.stringBuffer += ch; // Note: semantic character value preserved!
          this.repairs.push({
             code: "R_ESCAPE_RAW_CONTROL",
             byteRange: [byteOffset, byteOffset + charByteLen],
             impact: "representation_preserving",
             description: `Escaped raw control character U+${code.toString(16).padStart(4, "0")}`,
          });
        } else {
          this.emitDiagnostic(
            DiagnosticCode.W_RAW_CONTROL_CHARACTER,
            "error", // Reject mode makes this an error
            byteOffset,
            `Raw control character U+${code.toString(16).padStart(4, "0")} in string`,
            false,
          );
          this.state = ScannerState.Invalid;
          return;
        }
      } else {
        this.stringBuffer += ch;
      }
    }
  }

  private processEscape(ch: string, byteOffset: number, _charByteLen: number): void {
    switch (ch) {
      case '"':
      case "\\":
      case "/":
        this.stringBuffer += ch;
        this.state = ScannerState.InString;
        break;
      case "b":
        this.stringBuffer += "\b";
        this.state = ScannerState.InString;
        break;
      case "f":
        this.stringBuffer += "\f";
        this.state = ScannerState.InString;
        break;
      case "n":
        this.stringBuffer += "\n";
        this.state = ScannerState.InString;
        break;
      case "r":
        this.stringBuffer += "\r";
        this.state = ScannerState.InString;
        break;
      case "t":
        this.stringBuffer += "\t";
        this.state = ScannerState.InString;
        break;
      case "u":
        this.unicodeHexBuffer = "";
        this.state = ScannerState.UnicodeEscape;
        break;
      default:
        this.emitDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          byteOffset,
          `Invalid escape sequence: \\${ch}`,
          false,
        );
        this.state = ScannerState.Invalid;
        break;
    }
  }

  private processUnicodeEscape(ch: string, _byteOffset: number, _charByteLen: number): void {
    if (isHexDigit(ch)) {
      this.unicodeHexBuffer += ch;
      if (this.unicodeHexBuffer.length === 4) {
        const codeUnit = parseInt(this.unicodeHexBuffer, 16);

        if (this.highSurrogate !== 0) {
          // We expect a low surrogate
          if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            // Valid surrogate pair
            const fullCodePoint =
              0x10000 +
              ((this.highSurrogate - 0xd800) << 10) +
              (codeUnit - 0xdc00);
            this.stringBuffer += String.fromCodePoint(fullCodePoint);
            this.highSurrogate = 0;
            this.state = ScannerState.InString;
          } else {
            // Expected low surrogate, got something else
            this.emitDiagnostic(
              DiagnosticCode.E_UNPAIRED_SURROGATE,
              "error",
              this.currentByteOffset,
              `Expected low surrogate after \\u${this.highSurrogate.toString(16).padStart(4, "0")}, got \\u${this.unicodeHexBuffer}`,
              false,
            );
            this.highSurrogate = 0;
            this.state = ScannerState.Invalid;
          }
        } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
          // High surrogate — need to see \uDC00-\uDFFF next
          this.highSurrogate = codeUnit;
          this.surrogatePhase = 0;
          this.state = ScannerState.UnicodeSurrogatePending;
        } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
          // Unexpected low surrogate without high
          this.emitDiagnostic(
            DiagnosticCode.E_UNPAIRED_SURROGATE,
            "error",
            this.currentByteOffset,
            `Unexpected low surrogate: \\u${this.unicodeHexBuffer}`,
            false,
          );
          this.state = ScannerState.Invalid;
        } else {
          this.stringBuffer += String.fromCharCode(codeUnit);
          this.state = ScannerState.InString;
        }
        this.unicodeHexBuffer = "";
      }
    } else {
      this.emitDiagnostic(
        DiagnosticCode.E_INVALID_UNICODE_ESCAPE,
        "error",
        this.currentByteOffset,
        `Invalid hex digit in unicode escape: ${ch}`,
        false,
      );
      this.state = ScannerState.Invalid;
    }
  }

  private processSurrogatePending(ch: string, byteOffset: number, _charByteLen: number): void {
    // Expecting \uDCxx sequence
    // surrogatePhase: 0 = expecting \, 1 = expecting u
    if (this.surrogatePhase === 0) {
      if (ch === "\\") {
        this.surrogatePhase = 1;
      } else {
        // Not a surrogate pair continuation — unpaired high surrogate
        this.emitDiagnostic(
          DiagnosticCode.E_UNPAIRED_SURROGATE,
          "error",
          byteOffset,
          `Expected \\u for low surrogate, got: ${JSON.stringify(ch)}`,
          false,
        );
        this.highSurrogate = 0;
        this.state = ScannerState.Invalid;
      }
    } else if (this.surrogatePhase === 1) {
      if (ch === "u") {
        this.unicodeHexBuffer = "";
        this.surrogatePhase = 0;
        this.state = ScannerState.UnicodeEscape;
      } else {
        this.emitDiagnostic(
          DiagnosticCode.E_UNPAIRED_SURROGATE,
          "error",
          byteOffset,
          `Expected 'u' after '\\' for low surrogate, got: ${JSON.stringify(ch)}`,
          false,
        );
        this.highSurrogate = 0;
        this.state = ScannerState.Invalid;
      }
    }
  }

  private processNumber(ch: string, byteOffset: number, charByteLen: number): void {
    switch (this.state) {
      case ScannerState.NumberInteger:
        if (isDigit(ch)) {
          this.numberBuffer += ch;
          this.numberHasDigit = true;
        } else if (ch === "." && this.numberHasDigit) {
          this.numberBuffer += ch;
          this.state = ScannerState.NumberFraction;
        } else if ((ch === "e" || ch === "E") && this.numberHasDigit) {
          this.numberBuffer += ch;
          this.state = ScannerState.NumberExponentStart;
        } else if (this.numberHasDigit && this.isValueTerminator(ch)) {
          this.commitNumber(byteOffset);
          this.reprocessChar(ch, byteOffset, charByteLen);
        } else {
          this.emitDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            byteOffset,
            `Invalid character in number: ${JSON.stringify(ch)}`,
            false,
          );
          this.state = ScannerState.Invalid;
        }
        break;

      case ScannerState.NumberFraction:
        if (isDigit(ch)) {
          this.numberBuffer += ch;
        } else if (ch === "e" || ch === "E") {
          this.numberBuffer += ch;
          this.state = ScannerState.NumberExponentStart;
        } else if (this.isValueTerminator(ch)) {
          // Validate that we have at least one fraction digit
          const lastChar = this.numberBuffer[this.numberBuffer.length - 1];
          if (lastChar === ".") {
            this.emitDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              byteOffset,
              "Number has trailing decimal point with no digits",
              false,
            );
            this.state = ScannerState.Invalid;
          } else {
            this.commitNumber(byteOffset);
            this.reprocessChar(ch, byteOffset, charByteLen);
          }
        } else {
          this.emitDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            byteOffset,
            `Invalid character in number fraction: ${JSON.stringify(ch)}`,
            false,
          );
          this.state = ScannerState.Invalid;
        }
        break;

      case ScannerState.NumberExponentStart:
        if (isDigit(ch)) {
          this.numberBuffer += ch;
          this.state = ScannerState.NumberExponent;
        } else if (ch === "+" || ch === "-") {
          this.numberBuffer += ch;
          this.state = ScannerState.NumberExponent;
        } else {
          this.emitDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            byteOffset,
            `Expected digit or sign after exponent, got: ${JSON.stringify(ch)}`,
            false,
          );
          this.state = ScannerState.Invalid;
        }
        break;

      case ScannerState.NumberExponent:
        if (isDigit(ch)) {
          this.numberBuffer += ch;
        } else if (this.isValueTerminator(ch)) {
          // Validate we have at least one exponent digit
          const last = this.numberBuffer[this.numberBuffer.length - 1];
          if (last === "+" || last === "-" || last === "e" || last === "E") {
            this.emitDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              byteOffset,
              "Number has exponent with no digits",
              false,
            );
            this.state = ScannerState.Invalid;
          } else {
            this.commitNumber(byteOffset);
            this.reprocessChar(ch, byteOffset, charByteLen);
          }
        } else {
          this.emitDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            byteOffset,
            `Invalid character in number exponent: ${JSON.stringify(ch)}`,
            false,
          );
          this.state = ScannerState.Invalid;
        }
        break;
    }
  }

  private processLiteral(ch: string, byteOffset: number, charByteLen: number): void {
    const expected = this.literalTarget[this.literalIndex];
    if (ch === expected) {
      this.literalIndex++;
      if (this.literalIndex === this.literalTarget.length) {
        // Literal is fully matched, but we can't emit until we see a terminator.
        // Stay in the literal state — the next character will either be a terminator
        // or invalid. We handle this by checking if we've reached the full length
        // in the next call.
        // Actually, we need to wait for a terminator to commit the literal,
        // similar to numbers. Let's transition to a "literal complete, awaiting terminator" state.
        // For simplicity, we'll check on the next character.
      }
    } else if (this.literalIndex === this.literalTarget.length) {
      // Literal was fully matched — this character is the terminator
      if (this.isValueTerminator(ch)) {
        const type =
          this.literalTarget === "true"
            ? TokenType.True
            : this.literalTarget === "false"
              ? TokenType.False
              : TokenType.Null;
        this.emitToken(
          type,
          this.literalTarget,
          this.literalByteStart,
          byteOffset,
        );
        this.state = ScannerState.Structural;
        this.reprocessChar(ch, byteOffset, charByteLen);
      } else {
        this.emitDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          byteOffset,
          `Expected value terminator after '${this.literalTarget}', got: ${JSON.stringify(ch)}`,
          false,
        );
        this.state = ScannerState.Invalid;
      }
    } else {
      this.emitDiagnostic(
        DiagnosticCode.E_UNEXPECTED_TOKEN,
        "error",
        byteOffset,
        `Invalid literal: expected '${this.literalTarget[this.literalIndex]}' but got '${ch}' (parsing '${this.literalTarget}')`,
        false,
      );
      this.state = ScannerState.Invalid;
    }
  }

  private processTrailingWhitespace(ch: string, byteOffset: number): void {
    if (isWhitespace(ch)) return;

    // Non-whitespace after root value
    this.emitDiagnostic(
      DiagnosticCode.E_TRAILING_DATA,
      "error",
      byteOffset,
      `Unexpected data after root JSON value: ${JSON.stringify(ch)}`,
      false,
    );
    this.state = ScannerState.TrailingData;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private beginString(byteOffset: number): void {
    this.stringBuffer = "";
    this.stringByteStart = byteOffset;
    this.stringIsKey = this.nextStringIsKey;
    this.nextStringIsKey = false;
    this.highSurrogate = 0;
    this.state = ScannerState.InString;
  }

  private beginNumber(firstChar: string, byteOffset: number): void {
    this.numberBuffer = firstChar;
    this.numberByteStart = byteOffset;
    this.numberHasDigit = firstChar !== "-";
    this.state = ScannerState.NumberInteger;
  }

  private beginLiteral(target: string, byteOffset: number): void {
    this.literalTarget = target;
    this.literalIndex = 1; // first char already matched
    this.literalByteStart = byteOffset;
    if (target === "true") {
      this.state = ScannerState.LiteralTrue;
    } else if (target === "false") {
      this.state = ScannerState.LiteralFalse;
    } else {
      this.state = ScannerState.LiteralNull;
    }
  }

  private commitNumber(endByteOffset: number): void {
    // NumberFraction/NumberExponent's terminator branches already reject
    // trailing "."/exponent-with-no-digit before calling this; leading zero
    // is not caught by any state transition, so it's checked uniformly here
    // for all three call sites (integer, fraction, exponent terminators).
    const error = this.numberGrammarError();
    if (error !== null) {
      this.emitDiagnostic(
        DiagnosticCode.E_UNEXPECTED_TOKEN,
        "error",
        this.numberByteStart,
        error,
        false,
      );
      this.state = ScannerState.Invalid;
      return;
    }
    this.emitToken(
      TokenType.Number,
      this.numberBuffer,
      this.numberByteStart,
      endByteOffset,
    );
    this.numberBuffer = "";
    this.state = ScannerState.Structural;
  }

  private isValueTerminator(ch: string): boolean {
    return (
      isWhitespace(ch) ||
      ch === "," ||
      ch === "}" ||
      ch === "]" ||
      ch === ":"
    );
  }

  private reprocessChar(ch: string, byteOffset: number, charByteLen: number): void {
    // After committing a number/literal, state has been set to Structural.
    // Reprocess the terminating character in the new state.
    this.feedChar(ch, byteOffset, charByteLen);
  }

  private emitToken(
    type: TokenType,
    value: string,
    byteStart: number,
    byteEnd: number,
  ): void {
    this.tokens.push({ type, value, byteStart, byteEnd });
  }

  private emitDiagnostic(
    code: string,
    severity: "info" | "warning" | "error" | "fatal",
    byteOffset: number,
    message: string,
    recoverable: boolean,
  ): void {
    this.diagnostics.push(
      createDiagnostic(code, severity, byteOffset, message, recoverable),
    );
  }
}
