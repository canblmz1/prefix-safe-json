// ---------------------------------------------------------------------------
// IncrementalJsonParser — main parser implementation
// ---------------------------------------------------------------------------
//
// Integrates: UTF-8 decoder → Lexer/Scanner → Grammar Stack → Event Builder
//
// Public API: push(), snapshot(), drainEvents(), finish()
// ---------------------------------------------------------------------------

import type {
  IncrementalJsonParser,
  ParserOptions,
  ParserLimits,
  PushResult,
  ParserSnapshot,
  ParserEvent,
  FinalResult,
  SyntaxStatus,
  PendingToken,
  Diagnostic,
  RepairAction,
  RepairOptions,
  JsonValue,
  StreamEndReason,
} from "./types.js";
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
  return new Parser(options);
}

class Parser implements IncrementalJsonParser {
  private readonly limits: ParserLimits;
  private readonly utf8: Utf8Decoder;
  private readonly scanner: Scanner;
  private readonly grammar: GrammarStack;
  private readonly events: EventBuilder;
  private readonly snapshot_: SnapshotBuilder;
  private readonly allDiagnostics: Diagnostic[] = [];
  private readonly allRepairs: RepairAction[] = [];

  // Sticky flags mirroring the *existence* of certain diagnostics/repairs,
  // set unconditionally in addDiagnostic()/addRepair() regardless of
  // whether the corresponding array is at its maxQueuedEvents cap. Several
  // checks (isExecutable, determineOutcome) need an exact, monotonic answer
  // to "did X ever happen for this stream" — re-deriving that by scanning
  // allDiagnostics/allRepairs is unsound once those arrays can be truncated,
  // since a disqualifying entry could be the one silently dropped. This is
  // the same reasoning that already made grammar.hasDuplicate a dedicated
  // boolean instead of an array scan.
  private everHadFatalDiagnostic = false;
  private everHadNonRecoverableError = false;
  private everHadStructuralOrLossyRepair = false;
  private everHadCloseContainerRepair = false;

  private phase: "collecting" | "finished" = "collecting";
  private receivedBytes = 0;
  private consumedBytes = 0;
  private rootComplete = false;
  private terminal = false;
  private hasSeenValue = false;
  private syntax_: SyntaxStatus = "empty";
  private trailingDataSeen = false;
  private trailingDataBytes = 0;
  private rootScalarValue: JsonValue | undefined = undefined;
  
  private readonly repairs: RepairOptions;

  // Track if we're in a duplicate-key value (to skip it)
  private skipValueDepth = 0;
  private isSkippingValue = false;

  // For finish
  private finishMeta: { reason?: StreamEndReason; providerReason?: string } | undefined;

  constructor(options?: ParserOptions) {
    const userLimits = options?.limits ?? {};
    this.limits = {
      maxInputBytes: userLimits.maxInputBytes ?? DEFAULT_LIMITS.maxInputBytes,
      maxDepth: userLimits.maxDepth ?? DEFAULT_LIMITS.maxDepth,
      maxStringBytes:
        userLimits.maxStringBytes ?? DEFAULT_LIMITS.maxStringBytes,
      maxQueuedEvents:
        userLimits.maxQueuedEvents ?? DEFAULT_LIMITS.maxQueuedEvents,
      maxTrailingDataBytes:
        userLimits.maxTrailingDataBytes ?? DEFAULT_LIMITS.maxTrailingDataBytes,
    };
    
    this.repairs = {
      rawControlCharacters: options?.repairs?.rawControlCharacters ?? "reject",
      trailingData: options?.repairs?.trailingData ?? "isolate",
      closeContainersAtFinish: options?.repairs?.closeContainersAtFinish ?? "disabled",
    };

    this.utf8 = new Utf8Decoder();
    this.scanner = new Scanner(options);
    this.grammar = new GrammarStack(this.limits.maxDepth);
    this.events = new EventBuilder(this.limits.maxQueuedEvents);
    this.snapshot_ = new SnapshotBuilder();
  }

  push(chunk: string | Uint8Array): PushResult {
    if (this.phase === "finished") {
      throw new Error("E_PUSH_AFTER_FINISH: push() called after finish()");
    }

    if (this.terminal) {
      return {
        acceptedBytes: 0,
        emittedEvents: 0,
        syntax: this.syntax_,
        terminal: true,
      };
    }

    // Convert string to bytes
    const bytes =
      typeof chunk === "string" ? stringToUtf8(chunk) : chunk;

    // Check input limit
    if (this.receivedBytes + bytes.length > this.limits.maxInputBytes) {
      const diag = createDiagnostic(
        DiagnosticCode.E_LIMIT_INPUT_BYTES,
        "fatal",
        this.receivedBytes,
        `Input exceeds maximum of ${this.limits.maxInputBytes} bytes`,
        false,
      );
      this.addDiagnostic(diag);
      this.terminal = true;
      this.syntax_ = "invalid";
      return {
        acceptedBytes: 0,
        emittedEvents: 0,
        syntax: this.syntax_,
        terminal: true,
      };
    }

    this.receivedBytes += bytes.length;
    this.events.resetPushCount();

    // Decode UTF-8
    const decoded = this.utf8.decode(bytes);
    
    if (decoded.strippedBom) {
       const repair: RepairAction = {
         code: "R_STRIP_UTF8_BOM",
         byteRange: [0, 3],
         impact: "representation_preserving",
         description: "Stripped UTF-8 BOM at index 0",
       };
       this.addRepair(repair);
    }

    // Handle UTF-8 errors
    for (const err of decoded.errors) {
      const code =
        err.kind === "overlong"
          ? DiagnosticCode.E_INVALID_UTF8
          : err.kind === "out_of_range"
            ? DiagnosticCode.E_INVALID_UTF8
            : err.kind === "invalid_start_byte"
              ? DiagnosticCode.E_INVALID_UTF8
              : DiagnosticCode.E_INVALID_UTF8;
      const diag = createDiagnostic(
        code,
        "error",
        err.byteOffset,
        `Invalid UTF-8: ${err.kind} at byte ${err.byteOffset}`,
        false,
      );
      this.addDiagnostic(diag);
      this.syntax_ = "invalid";
      this.terminal = true;
      return {
        acceptedBytes: decoded.consumed,
        emittedEvents: this.events.emittedDuringPush,
        syntax: this.syntax_,
        terminal: true,
      };
    }

    // Feed decoded text to scanner character by character
    const text = decoded.text;
    // Track byte positions via UTF-8 encoding
    let bytePos = this.consumedBytes;

    for (const ch of text) {
      if (this.terminal) break;

      const charBytes = getUtf8ByteLength(ch);

      // If root is already complete, handle trailing content at parser level
      if (this.rootComplete) {
        const isWs = ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
        if (!isWs) {
          if (!this.trailingDataSeen) {
            this.trailingDataSeen = true;
            if (this.repairs.trailingData === "reject") {
              this.addDiagnostic(createDiagnostic(DiagnosticCode.E_TRAILING_DATA, "error", bytePos, `Trailing data rejected`, false));
              this.syntax_ = "invalid";
              this.terminal = true;
              return {
                acceptedBytes: decoded.consumed,
                emittedEvents: this.events.emittedDuringPush,
                syntax: this.syntax_,
                terminal: true,
              };
            }
            
            this.addDiagnostic(
              createDiagnostic(
                DiagnosticCode.E_TRAILING_DATA,
                "warning",
                bytePos,
                `Unexpected data after root JSON value`,
                true,
              ),
            );
            const repair: RepairAction = {
              code: "R_ISOLATE_TRAILING_DATA",
              byteRange: [bytePos, bytePos + charBytes],
              impact: "root_preserving",
              description: "Isolated trailing data after complete JSON root",
            };
            this.addRepair(repair);
          }
          
          this.trailingDataBytes += charBytes;
          if (this.trailingDataBytes > this.limits.maxTrailingDataBytes) {
             this.addDiagnostic(
                createDiagnostic(
                  DiagnosticCode.E_LIMIT_INPUT_BYTES,
                  "error",
                  bytePos,
                  `Maximum trailing data bytes exceeded`,
                  false,
                ),
              );
              this.syntax_ = "invalid";
              this.terminal = true;
          }
        }
        bytePos += charBytes;
        continue;
      }

      // Set up scanner for object key context
      const frame = this.grammar.current;
      if (
        frame &&
        frame.containerType === "object" &&
        (frame.objectExpectation === "first_key_or_end" || frame.objectExpectation === "key_after_comma") &&
        this.scanner.currentState === ScannerState.Structural
      ) {
        this.scanner.setNextStringIsKey(true);
      }

      this.scanner.feedChar(ch, bytePos, charBytes);

      // Process any emitted tokens
      const tokens = this.scanner.takeTokens();
      for (const token of tokens) {
        if (this.terminal) break;
        this.processToken(token);
      }

      // Process any scanner diagnostics and repairs
      const scanDiags = this.scanner.takeDiagnostics();
      const scanRepairs = this.scanner.takeRepairs();
      
      for (const repair of scanRepairs) {
        this.addRepair(repair);
      }
      
      for (const diag of scanDiags) {
        this.addDiagnostic(diag);
        if (
          diag.severity === "fatal" ||
          (diag.severity === "error" && !diag.recoverable)
        ) {
          this.syntax_ = "invalid";
          this.terminal = true;
        }
      }

      // After processing tokens, check if rootComplete was just set
      // and handle trailing data detection
      if (this.rootComplete && !this.trailingDataSeen) {
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
        this.addDiagnostic(diag);
        if (diag.severity === "fatal") {
          this.terminal = true;
          this.syntax_ = "invalid";
        }
      }

      if (this.events.isTerminal) {
        this.terminal = true;
        this.syntax_ = "invalid";
        break;
      }

      bytePos += charBytes;
    }

    this.consumedBytes = bytePos;

    return {
      acceptedBytes: decoded.consumed,
      emittedEvents: this.events.emittedDuringPush,
      syntax: this.syntax_,
      terminal: this.terminal,
    };
  }

  snapshot(): ParserSnapshot {
    const pending = this.buildPendingTokens();

    return {
      phase: this.phase,
      syntax: this.syntax_,
      stableValue: this.buildStableValue(),
      rootComplete: this.rootComplete,
      executable: this.isExecutable(),
      pending,
      repairs: Object.freeze([...this.allRepairs]),
      diagnostics: Object.freeze([...this.allDiagnostics]),
      receivedBytes: this.receivedBytes,
      consumedBytes: this.consumedBytes,
    };
  }

  drainEvents(): readonly ParserEvent[] {
    return this.events.drain();
  }

  finish(meta?: {
    reason?: StreamEndReason;
    providerReason?: string;
  }): FinalResult {
    if (this.phase === "finished") {
      throw new Error(
        "E_PUSH_AFTER_FINISH: finish() called more than once",
      );
    }

    this.phase = "finished";
    this.finishMeta = meta;

    const reason = meta?.reason ?? "unknown";

    // Try to finalize any pending number or literal at stream end
    if (!this.terminal) {
      // Check for pending number — at stream end, numbers can be finalized
      // only if the stream completed normally
      const pendingInfo = this.scanner.getPendingInfo();

      if (pendingInfo.type === "number") {
        if (reason === "complete") {
          // Stream ended normally — the number terminator is implicit EOF
          const finalized = this.scanner.finalizeNumber();
          if (finalized === "finalized") {
            const tokens = this.scanner.takeTokens();
            for (const token of tokens) {
              this.processToken(token);
            }
          } else if (finalized === "invalid") {
            this.addDiagnostic(
              createDiagnostic(
                DiagnosticCode.E_UNEXPECTED_TOKEN,
                "error",
                pendingInfo.byteStart,
                `Invalid number at stream end: ${pendingInfo.buffer}`,
                false,
              ),
            );
          }
          // "not_ready": scanner wasn't in a finalizable number state at all
          // (e.g. buffer is just "-", or ends right at a bare "e"/"E") —
          // preserved exactly as before: no diagnostic added here.
        } else {
          // Truncated — number is incomplete
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_INCOMPLETE_NUMBER,
              "error",
              pendingInfo.byteStart,
              `Incomplete number at stream end: ${pendingInfo.buffer}`,
              false,
            ),
          );
        }
      } else if (pendingInfo.type === "literal") {
        if (
          reason === "complete" &&
          pendingInfo.buffer.length ===
            (pendingInfo.buffer === "tru" || pendingInfo.buffer === "fal"
              ? 0
              : pendingInfo.buffer.length)
        ) {
          const finalized = this.scanner.finalizeLiteral();
          if (finalized) {
            const tokens = this.scanner.takeTokens();
            for (const token of tokens) {
              this.processToken(token);
            }
          } else {
            this.addDiagnostic(
              createDiagnostic(
                DiagnosticCode.E_INCOMPLETE_LITERAL,
                "error",
                pendingInfo.byteStart,
                `Incomplete literal at stream end: ${pendingInfo.buffer}`,
                false,
              ),
            );
          }
        } else {
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_INCOMPLETE_LITERAL,
              "error",
              pendingInfo.byteStart,
              `Incomplete literal at stream end: ${pendingInfo.buffer}`,
              false,
            ),
          );
        }
      } else if (
        pendingInfo.type === "string" ||
        pendingInfo.type === "object_key" as string
      ) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNTERMINATED_STRING,
            "error",
            pendingInfo.byteStart,
            "Unterminated string at stream end",
            false,
          ),
        );
      } else if (pendingInfo.type === "unicode_escape") {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_INCOMPLETE_UNICODE_ESCAPE,
            "error",
            pendingInfo.byteStart,
            "Incomplete unicode escape at stream end",
            false,
          ),
        );
      } else if (pendingInfo.type === "surrogate") {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNPAIRED_SURROGATE,
            "error",
            pendingInfo.byteStart,
            "Unpaired surrogate at stream end",
            false,
          ),
        );
      }

      // Check for incomplete UTF-8
      if (this.utf8.hasIncomplete()) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_INCOMPLETE_UTF8,
            "error",
            this.utf8.incompleteByteOffset(),
            "Incomplete UTF-8 sequence at stream end",
            false,
          ),
        );
      }
    }

    // Check for truncation
    if (
      !this.rootComplete &&
      reason !== "complete"
    ) {
      // Attempt structural salvage
      let salvaged = false;
      if (
        this.repairs.closeContainersAtFinish === "safe-only" &&
        this.scanner.currentState === ScannerState.Structural &&
        this.scanner.getPendingInfo().type === "none" &&
        this.grammar.canSafelyCloseAll() &&
        !this.hasFatalDiagnostic() &&
        (this.syntax_ !== "invalid")
      ) {
        salvaged = true;
        const frames = this.grammar.getFrames();
        // We know exactly what to close, just close them all
        for (let i = frames.length - 1; i >= 0; i--) {
          const frame = frames[i];
          if (frame) {
            this.events.emitContainerClosed(frame.path, frame.containerType);
          }
        }
        
        const repair: RepairAction = {
           code: "R_CLOSE_CONTAINER",
           byteRange: [this.consumedBytes, this.consumedBytes],
           impact: "structural",
           description: `Safely closed ${frames.length} containers at stream end`,
        };
        this.addRepair(repair);
        this.rootComplete = true;
      }

      if (!salvaged) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_STREAM_TRUNCATED,
            "error",
            this.consumedBytes,
            `Stream truncated: ${reason}`,
            false,
          ),
        );
      }
    } else if (!this.rootComplete && reason === "complete") {
      // Stream said complete but root isn't closed
      if (this.hasSeenValue) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_STREAM_TRUNCATED,
            "error",
            this.consumedBytes,
            "Stream marked complete but JSON root is not closed",
            false,
          ),
        );
      }
    }

    const outcome = this.determineOutcome(reason);
    const executable = this.isExecutable();

    // Emit finish events
    if (this.rootComplete && !this.grammar.hasDuplicate && !this.hasFatalDiagnostic()) {
      this.events.emitDocumentComplete(executable);
    }
    this.events.emitStreamFinished(outcome);

    return {
      syntax: this.syntax_,
      outcome,
      stableValue: this.buildStableValue(),
      executable,
      repairs: Object.freeze([...this.allRepairs]),
      diagnostics: Object.freeze([...this.allDiagnostics]),
      receivedBytes: this.receivedBytes,
      consumedBytes: this.consumedBytes,
    };
  }

  // -----------------------------------------------------------------------
  // Token processing
  // -----------------------------------------------------------------------

  private processToken(token: Token): void {
    // Handle value skipping (duplicate key value)
    if (this.isSkippingValue) {
      if (
        token.type === TokenType.ObjectStart ||
        token.type === TokenType.ArrayStart
      ) {
        this.skipValueDepth++;
      } else if (
        token.type === TokenType.ObjectEnd ||
        token.type === TokenType.ArrayEnd
      ) {
        this.skipValueDepth--;
        if (this.skipValueDepth <= 0) {
          this.isSkippingValue = false;
          this.skipValueDepth = 0;
          // Resume normal flow — need to advance the object expectation
          const frame = this.grammar.current;
          if (frame && frame.containerType === "object") {
            frame.objectExpectation = "comma_or_end";
          }
        }
      } else if (this.skipValueDepth === 0) {
        // Scalar value for duplicate key — skip it
        if (
          token.type === TokenType.String ||
          token.type === TokenType.Number ||
          token.type === TokenType.True ||
          token.type === TokenType.False ||
          token.type === TokenType.Null
        ) {
          this.isSkippingValue = false;
          const frame = this.grammar.current;
          if (frame && frame.containerType === "object") {
            frame.objectExpectation = "comma_or_end";
          }
        }
      }
      return;
    }


    switch (token.type) {
      case TokenType.ObjectStart:
        this.handleObjectStart(token);
        break;
      case TokenType.ObjectEnd:
        this.handleObjectEnd(token);
        break;
      case TokenType.ArrayStart:
        this.handleArrayStart(token);
        break;
      case TokenType.ArrayEnd:
        this.handleArrayEnd(token);
        break;
      case TokenType.Colon:
        this.handleColon(token);
        break;
      case TokenType.Comma:
        this.handleComma(token);
        break;
      case TokenType.String:
        this.handleString(token);
        break;
      case TokenType.Number:
        this.handleNumber(token);
        break;
      case TokenType.True:
      case TokenType.False:
      case TokenType.Null:
        this.handleLiteral(token);
        break;
    }
  }

  private handleObjectStart(token: Token): void {
    const frame = this.grammar.current;

    // Validate context
    if (frame) {
      if (frame.containerType === "object") {
        if (frame.objectExpectation !== "value") {
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              token.byteStart,
              "Unexpected '{'",
              false,
            ),
          );
          this.terminal = true;
          this.syntax_ = "invalid";
          return;
        }
      } else if (frame.containerType === "array") {
        if (
          frame.arrayExpectation !== "first_value_or_end" &&
          frame.arrayExpectation !== "value_after_comma"
        ) {
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              token.byteStart,
              "Unexpected '{' in array",
              false,
            ),
          );
          this.terminal = true;
          this.syntax_ = "invalid";
          return;
        }
      }
    }

    const newFrame = this.grammar.pushObject(token.byteStart);
    if (!newFrame) {
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    this.hasSeenValue = true;
    if (this.syntax_ === "empty") {
      this.syntax_ = "incomplete";
    }

    // Init container in snapshot builder
    if (!this.grammar.isEmpty()) {
      if (this.grammar.depth === 1) {
        this.snapshot_.initRootObject(newFrame);
      } else {
        this.snapshot_.initContainerForFrame(newFrame, "object");
      }
    }
  }

  private handleObjectEnd(token: Token): void {
    const frame = this.grammar.current;
    if (!frame || frame.containerType !== "object") {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          "Unexpected '}' — no matching open object",
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    if (
      frame.objectExpectation !== "first_key_or_end" &&
      frame.objectExpectation !== "comma_or_end"
    ) {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          `Unexpected '}' while expecting ${frame.objectExpectation}`,
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    this.grammar.pop();
    this.events.emitContainerClosed(frame.path, "object");

    // If this closes the root, emit the full object as committed
    if (this.grammar.isEmpty()) {
      this.rootComplete = true;
      this.syntax_ = "root_complete";
    } else {
      // Value committed for parent
      this.commitContainerToParent(frame.path, token);
    }
  }

  private handleArrayStart(token: Token): void {
    const frame = this.grammar.current;

    // Validate context
    if (frame) {
      if (frame.containerType === "object") {
        if (frame.objectExpectation !== "value") {
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              token.byteStart,
              "Unexpected '['",
              false,
            ),
          );
          this.terminal = true;
          this.syntax_ = "invalid";
          return;
        }
      } else if (frame.containerType === "array") {
        if (
          frame.arrayExpectation !== "first_value_or_end" &&
          frame.arrayExpectation !== "value_after_comma"
        ) {
          this.addDiagnostic(
            createDiagnostic(
              DiagnosticCode.E_UNEXPECTED_TOKEN,
              "error",
              token.byteStart,
              "Unexpected '[' in array",
              false,
            ),
          );
          this.terminal = true;
          this.syntax_ = "invalid";
          return;
        }
      }
    }

    const newFrame = this.grammar.pushArray(token.byteStart);
    if (!newFrame) {
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    this.hasSeenValue = true;
    if (this.syntax_ === "empty") {
      this.syntax_ = "incomplete";
    }

    // Init container in snapshot builder
    if (this.grammar.depth === 1) {
      this.snapshot_.initRootArray(newFrame);
    } else {
      this.snapshot_.initContainerForFrame(newFrame, "array");
    }
  }

  private handleArrayEnd(token: Token): void {
    const frame = this.grammar.current;
    if (!frame || frame.containerType !== "array") {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          "Unexpected ']' — no matching open array",
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    if (
      frame.arrayExpectation !== "first_value_or_end" &&
      frame.arrayExpectation !== "comma_or_end"
    ) {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          "Unexpected ']'",
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    this.grammar.pop();
    this.events.emitContainerClosed(frame.path, "array");

    if (this.grammar.isEmpty()) {
      this.rootComplete = true;
      this.syntax_ = "root_complete";
    } else {
      this.commitContainerToParent(frame.path, token);
    }
  }

  private handleColon(token: Token): void {
    const frame = this.grammar.current;
    if (!frame || frame.containerType !== "object" || frame.objectExpectation !== "colon") {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          "Unexpected ':'",
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }
    frame.objectExpectation = "value";
  }

  private handleComma(token: Token): void {
    const frame = this.grammar.current;
    if (!frame) {
      this.addDiagnostic(
        createDiagnostic(
          DiagnosticCode.E_UNEXPECTED_TOKEN,
          "error",
          token.byteStart,
          "Unexpected ','",
          false,
        ),
      );
      this.terminal = true;
      this.syntax_ = "invalid";
      return;
    }

    if (frame.containerType === "object") {
      if (frame.objectExpectation !== "comma_or_end") {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            token.byteStart,
            "Unexpected ',' in object",
            false,
          ),
        );
        this.terminal = true;
        this.syntax_ = "invalid";
        return;
      }
      frame.objectExpectation = "key_after_comma";
    } else {
      if (frame.arrayExpectation !== "comma_or_end") {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            token.byteStart,
            "Unexpected ',' in array",
            false,
          ),
        );
        this.terminal = true;
        this.syntax_ = "invalid";
        return;
      }
      frame.arrayExpectation = "value_after_comma";
    }
  }

  private handleString(token: Token): void {
    const frame = this.grammar.current;

    if (!frame) {
      // Root-level string value
      this.hasSeenValue = true;
      this.rootComplete = true;
      this.syntax_ = "root_complete";
      this.events.emitValueCommitted("", token.value, [
        token.byteStart,
        token.byteEnd,
      ]);
      this.rootScalarValue = token.value;
      return;
    }

    if (frame.containerType === "object") {
      if (
        frame.objectExpectation === "first_key_or_end" ||
        frame.objectExpectation === "key_after_comma"
      ) {
        // This is an object key
        const isNew = this.grammar.registerObjectKey(
          token.value,
          token.byteStart,
        );
        if (!isNew) {
          // Duplicate key — skip the upcoming value
          // The grammar registered the diagnostic already
          const dupDiags = this.grammar.takeDiagnostics();
          for (const d of dupDiags) {
            this.addDiagnostic(d);
          }
          frame.objectExpectation = "colon";
          this.isSkippingValue = true;
          this.skipValueDepth = 0;
          return;
        }
        frame.objectExpectation = "colon";
      } else if (frame.objectExpectation === "value") {
        // This is a string value for an object field
        const path = this.grammar.currentValuePath();
        this.events.emitValueCommitted(path, token.value, [
          token.byteStart,
          token.byteEnd,
        ]);
        this.snapshot_.processEvent({
          type: "value_committed",
          sequence: 0,
          path,
          operation: "add",
          value: token.value,
          byteRange: [token.byteStart, token.byteEnd],
        });
        frame.objectExpectation = "comma_or_end";
      }
    } else if (frame.containerType === "array") {
      if (
        frame.arrayExpectation !== "first_value_or_end" &&
        frame.arrayExpectation !== "value_after_comma"
      ) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            token.byteStart,
            "Unexpected string in array",
            false,
          ),
        );
        this.terminal = true;
        this.syntax_ = "invalid";
        return;
      }

      // Array element
      const path = this.grammar.currentValuePath();
      this.events.emitValueCommitted(path, token.value, [
        token.byteStart,
        token.byteEnd,
      ]);
      this.snapshot_.processEvent({
        type: "value_committed",
        sequence: 0,
        path,
        operation: "add",
        value: token.value,
        byteRange: [token.byteStart, token.byteEnd],
      });
      this.grammar.advanceArrayIndex();
      frame.arrayExpectation = "comma_or_end";
    }
  }

  private handleNumber(token: Token): void {
    const value = Number(token.value);
    this.commitScalar(value, token);
  }

  private handleLiteral(token: Token): void {
    let value: JsonValue;
    if (token.type === TokenType.True) value = true;
    else if (token.type === TokenType.False) value = false;
    else value = null;

    this.commitScalar(value, token);
  }

  private commitScalar(value: JsonValue, token: Token): void {
    const frame = this.grammar.current;

    if (!frame) {
      // Root-level scalar
      this.hasSeenValue = true;
      this.rootComplete = true;
      this.syntax_ = "root_complete";
      this.events.emitValueCommitted("", value, [
        token.byteStart,
        token.byteEnd,
      ]);
      // Store root scalar in snapshot builder
      // For root scalars, we directly set the root value
      this.rootScalarValue = value;
      return;
    }

    if (frame.containerType === "object") {
      if (frame.objectExpectation === "value") {
        const path = this.grammar.currentValuePath();
        this.events.emitValueCommitted(path, value, [
          token.byteStart,
          token.byteEnd,
        ]);
        this.snapshot_.processEvent({
          type: "value_committed",
          sequence: 0,
          path,
          operation: "add",
          value,
          byteRange: [token.byteStart, token.byteEnd],
        });
        frame.objectExpectation = "comma_or_end";
      }
    } else if (frame.containerType === "array") {
      if (
        frame.arrayExpectation !== "first_value_or_end" &&
        frame.arrayExpectation !== "value_after_comma"
      ) {
        this.addDiagnostic(
          createDiagnostic(
            DiagnosticCode.E_UNEXPECTED_TOKEN,
            "error",
            token.byteStart,
            "Unexpected scalar in array",
            false,
          ),
        );
        this.terminal = true;
        this.syntax_ = "invalid";
        return;
      }

      const path = this.grammar.currentValuePath();
      this.events.emitValueCommitted(path, value, [
        token.byteStart,
        token.byteEnd,
      ]);
      this.snapshot_.processEvent({
        type: "value_committed",
        sequence: 0,
        path,
        operation: "add",
        value,
        byteRange: [token.byteStart, token.byteEnd],
      });
      this.grammar.advanceArrayIndex();
      frame.arrayExpectation = "comma_or_end";
    }
  }

  private commitContainerToParent(_containerPath: string, _token: Token): void {
    const parentFrame = this.grammar.current;
    if (!parentFrame) return;

    if (parentFrame.containerType === "object") {
      // The closed container was a value in the parent object
      // The value_committed for the object field is implicitly done
      // when the container closes
      parentFrame.objectExpectation = "comma_or_end";
    } else if (parentFrame.containerType === "array") {
      this.grammar.advanceArrayIndex();
      parentFrame.arrayExpectation = "comma_or_end";
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private addDiagnostic(diag: Diagnostic): void {
    // Cap accumulation independently of the EventBuilder's own queue limit:
    // a consumer who drains events after every push() keeps that queue
    // short, which would otherwise let this array grow without bound for
    // the lifetime of the parser (see limits.maxQueuedEvents).
    if (diag.severity === "fatal") this.everHadFatalDiagnostic = true;
    if (
      (diag.severity === "error" || diag.severity === "fatal") &&
      !diag.recoverable
    ) {
      this.everHadNonRecoverableError = true;
    }
    if (this.allDiagnostics.length < this.limits.maxQueuedEvents) {
      this.allDiagnostics.push(diag);
    }
    this.events.emitDiagnostic(diag);
  }

  private addRepair(repair: RepairAction): void {
    if (repair.impact === "structural" || repair.impact === "lossy") {
      this.everHadStructuralOrLossyRepair = true;
    }
    if (repair.code === "R_CLOSE_CONTAINER") {
      this.everHadCloseContainerRepair = true;
    }
    if (this.allRepairs.length < this.limits.maxQueuedEvents) {
      this.allRepairs.push(repair);
    }
    this.events.emitRepairApplied(repair);
  }

  private isExecutable(): boolean {
    if (this.phase !== "finished") return false;
    if (!this.rootComplete) return false;

    const reason = this.finishMeta?.reason ?? "unknown";
    if (
      reason === "length" ||
      reason === "network_error" ||
      reason === "provider_error" ||
      reason === "cancelled" ||
      reason === "unknown"
    ) {
      return false;
    }

    if (this.grammar.hasDuplicate) return false;
    if (this.hasFatalDiagnostic()) return false;
    if (this.hasNonRecoverableError()) return false;
    if (this.everHadStructuralOrLossyRepair) return false;

    const pendingInfo = this.scanner.getPendingInfo();
    if (pendingInfo.type !== "none") return false;
    
    if (this.trailingDataSeen) return false;

    return true;
  }

  private hasFatalDiagnostic(): boolean {
    return this.everHadFatalDiagnostic;
  }

  private hasNonRecoverableError(): boolean {
    return this.everHadNonRecoverableError;
  }

  private determineOutcome(
    reason: StreamEndReason,
  ): FinalResult["outcome"] {
    if (this.syntax_ === "invalid") return "invalid";
    if (this.hasFatalDiagnostic()) return "invalid";
    if (this.grammar.hasDuplicate) return "invalid";
    
    // Check if salvaged
    if (this.everHadCloseContainerRepair) return "salvaged";

    if (!this.rootComplete) return "truncated";

    if (reason !== "complete" && reason !== "unknown") {
      // Reason indicates stream was cut off, but root is magically complete?
      // Since it's complete, the parsed JSON is fully intact.
      // We consider it valid, but potentially non-executable depending on policy.
      return "valid";
    }

    return "valid";
  }

  private buildStableValue(): JsonValue | undefined {
    if (this.rootScalarValue !== undefined) return this.rootScalarValue;
    return this.snapshot_.getStableValue();
  }

  private buildPendingTokens(): PendingToken[] {
    const pending: PendingToken[] = [];
    const info = this.scanner.getPendingInfo();

    if (info.type !== "none") {
      pending.push({
        type: info.type === "object_key" as string ? "object_key" : info.type,
        path: this.grammar.currentValuePath(),
        buffered: info.buffer,
        byteOffset: info.byteStart,
      } as PendingToken);
    }

    return pending;
  }
}

/**
 * Get the UTF-8 byte length of a character.
 */
function getUtf8ByteLength(ch: string): number {
  const code = ch.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}
