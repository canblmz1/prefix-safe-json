// @ts-nocheck
// ---------------------------------------------------------------------------
// Grammar Stack — tracks nested JSON container state
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
import type { GrammarFrame } from "./frame.js";
import { createObjectFrame, createArrayFrame } from "./frame.js";
import { appendPointer } from "./pointer.js";
import type { Diagnostic } from "../types.js";
import { DiagnosticCode } from "../diagnostics/codes.js";
import { createDiagnostic } from "../diagnostics/factory.js";

/**
 * Manages the stack of open JSON containers.
 * Handles object/array nesting, expectations, and duplicate key detection.
 */
export class GrammarStack {
  private stack: GrammarFrame[] = stryMutAct_9fa48("374") ? ["Stryker was here"] : (stryCov_9fa48("374"), []);
  private diagnostics: Diagnostic[] = stryMutAct_9fa48("375") ? ["Stryker was here"] : (stryCov_9fa48("375"), []);
  private hasDuplicateKey = stryMutAct_9fa48("376") ? true : (stryCov_9fa48("376"), false);
  private maxDepth: number;
  constructor(maxDepth: number) {
    if (stryMutAct_9fa48("377")) {
      {}
    } else {
      stryCov_9fa48("377");
      this.maxDepth = maxDepth;
    }
  }

  /** Current depth (number of open containers). */
  get depth(): number {
    if (stryMutAct_9fa48("378")) {
      {}
    } else {
      stryCov_9fa48("378");
      return this.stack.length;
    }
  }

  /** Whether any duplicate key has been seen. */
  get hasDuplicate(): boolean {
    if (stryMutAct_9fa48("379")) {
      {}
    } else {
      stryCov_9fa48("379");
      return this.hasDuplicateKey;
    }
  }

  /** Get the current (top) frame, or undefined if empty. */
  get current(): GrammarFrame | undefined {
    if (stryMutAct_9fa48("380")) {
      {}
    } else {
      stryCov_9fa48("380");
      return this.stack[stryMutAct_9fa48("381") ? this.stack.length + 1 : (stryCov_9fa48("381"), this.stack.length - 1)];
    }
  }

  /**
   * Push a new object container.
   * Returns the frame, or null if depth limit exceeded.
   */
  pushObject(byteStart: number): GrammarFrame | null {
    if (stryMutAct_9fa48("382")) {
      {}
    } else {
      stryCov_9fa48("382");
      if (stryMutAct_9fa48("386") ? this.stack.length < this.maxDepth : stryMutAct_9fa48("385") ? this.stack.length > this.maxDepth : stryMutAct_9fa48("384") ? false : stryMutAct_9fa48("383") ? true : (stryCov_9fa48("383", "384", "385", "386"), this.stack.length >= this.maxDepth)) {
        if (stryMutAct_9fa48("387")) {
          {}
        } else {
          stryCov_9fa48("387");
          this.diagnostics.push(createDiagnostic(DiagnosticCode.E_LIMIT_DEPTH, stryMutAct_9fa48("388") ? "" : (stryCov_9fa48("388"), "fatal"), byteStart, stryMutAct_9fa48("389") ? `` : (stryCov_9fa48("389"), `Maximum nesting depth ${this.maxDepth} exceeded`), stryMutAct_9fa48("390") ? true : (stryCov_9fa48("390"), false)));
          return null;
        }
      }
      const path = this.currentValuePath();
      const frame = createObjectFrame(path, byteStart);
      this.stack.push(frame);
      return frame;
    }
  }

  /**
   * Push a new array container.
   * Returns the frame, or null if depth limit exceeded.
   */
  pushArray(byteStart: number): GrammarFrame | null {
    if (stryMutAct_9fa48("391")) {
      {}
    } else {
      stryCov_9fa48("391");
      if (stryMutAct_9fa48("395") ? this.stack.length < this.maxDepth : stryMutAct_9fa48("394") ? this.stack.length > this.maxDepth : stryMutAct_9fa48("393") ? false : stryMutAct_9fa48("392") ? true : (stryCov_9fa48("392", "393", "394", "395"), this.stack.length >= this.maxDepth)) {
        if (stryMutAct_9fa48("396")) {
          {}
        } else {
          stryCov_9fa48("396");
          this.diagnostics.push(createDiagnostic(DiagnosticCode.E_LIMIT_DEPTH, stryMutAct_9fa48("397") ? "" : (stryCov_9fa48("397"), "fatal"), byteStart, stryMutAct_9fa48("398") ? `` : (stryCov_9fa48("398"), `Maximum nesting depth ${this.maxDepth} exceeded`), stryMutAct_9fa48("399") ? true : (stryCov_9fa48("399"), false)));
          return null;
        }
      }
      const path = this.currentValuePath();
      const frame = createArrayFrame(path, byteStart);
      this.stack.push(frame);
      return frame;
    }
  }

  /**
   * Pop the current container.
   * Returns the popped frame.
   */
  pop(): GrammarFrame | undefined {
    if (stryMutAct_9fa48("400")) {
      {}
    } else {
      stryCov_9fa48("400");
      return this.stack.pop();
    }
  }

  /**
   * Register an object key. Returns true if the key is new.
   * If duplicate, emits diagnostic and returns false.
   */
  registerObjectKey(key: string, byteOffset: number): boolean {
    if (stryMutAct_9fa48("401")) {
      {}
    } else {
      stryCov_9fa48("401");
      const frame = this.current;
      if (stryMutAct_9fa48("404") ? (!frame || frame.containerType !== "object") && !frame.seenKeys : stryMutAct_9fa48("403") ? false : stryMutAct_9fa48("402") ? true : (stryCov_9fa48("402", "403", "404"), (stryMutAct_9fa48("406") ? !frame && frame.containerType !== "object" : stryMutAct_9fa48("405") ? false : (stryCov_9fa48("405", "406"), (stryMutAct_9fa48("407") ? frame : (stryCov_9fa48("407"), !frame)) || (stryMutAct_9fa48("409") ? frame.containerType === "object" : stryMutAct_9fa48("408") ? false : (stryCov_9fa48("408", "409"), frame.containerType !== (stryMutAct_9fa48("410") ? "" : (stryCov_9fa48("410"), "object")))))) || (stryMutAct_9fa48("411") ? frame.seenKeys : (stryCov_9fa48("411"), !frame.seenKeys)))) {
        if (stryMutAct_9fa48("412")) {
          {}
        } else {
          stryCov_9fa48("412");
          return stryMutAct_9fa48("413") ? true : (stryCov_9fa48("413"), false);
        }
      }
      if (stryMutAct_9fa48("415") ? false : stryMutAct_9fa48("414") ? true : (stryCov_9fa48("414", "415"), frame.seenKeys.has(key))) {
        if (stryMutAct_9fa48("416")) {
          {}
        } else {
          stryCov_9fa48("416");
          this.hasDuplicateKey = stryMutAct_9fa48("417") ? false : (stryCov_9fa48("417"), true);
          this.diagnostics.push(createDiagnostic(DiagnosticCode.E_DUPLICATE_KEY, stryMutAct_9fa48("418") ? "" : (stryCov_9fa48("418"), "error"), byteOffset, stryMutAct_9fa48("419") ? `` : (stryCov_9fa48("419"), `Duplicate object key: ${JSON.stringify(key)}`), stryMutAct_9fa48("420") ? true : (stryCov_9fa48("420"), false), frame.path));
          return stryMutAct_9fa48("421") ? true : (stryCov_9fa48("421"), false);
        }
      }
      frame.seenKeys.add(key);
      frame.currentKey = key;
      return stryMutAct_9fa48("422") ? false : (stryCov_9fa48("422"), true);
    }
  }

  /**
   * Get the JSON Pointer path for where the next value will go.
   */
  currentValuePath(): string {
    if (stryMutAct_9fa48("423")) {
      {}
    } else {
      stryCov_9fa48("423");
      const frame = this.current;
      if (stryMutAct_9fa48("426") ? false : stryMutAct_9fa48("425") ? true : stryMutAct_9fa48("424") ? frame : (stryCov_9fa48("424", "425", "426"), !frame)) return stryMutAct_9fa48("427") ? "Stryker was here!" : (stryCov_9fa48("427"), "");
      if (stryMutAct_9fa48("430") ? frame.containerType !== "object" : stryMutAct_9fa48("429") ? false : stryMutAct_9fa48("428") ? true : (stryCov_9fa48("428", "429", "430"), frame.containerType === (stryMutAct_9fa48("431") ? "" : (stryCov_9fa48("431"), "object")))) {
        if (stryMutAct_9fa48("432")) {
          {}
        } else {
          stryCov_9fa48("432");
          if (stryMutAct_9fa48("435") ? frame.currentKey === undefined : stryMutAct_9fa48("434") ? false : stryMutAct_9fa48("433") ? true : (stryCov_9fa48("433", "434", "435"), frame.currentKey !== undefined)) {
            if (stryMutAct_9fa48("436")) {
              {}
            } else {
              stryCov_9fa48("436");
              return appendPointer(frame.path, frame.currentKey);
            }
          }
          return frame.path;
        }
      }
      // array
      return appendPointer(frame.path, frame.nextArrayIndex);
    }
  }

  /**
   * Advance the array index after an element value is committed.
   */
  advanceArrayIndex(): void {
    if (stryMutAct_9fa48("437")) {
      {}
    } else {
      stryCov_9fa48("437");
      const frame = this.current;
      if (stryMutAct_9fa48("440") ? frame || frame.containerType === "array" : stryMutAct_9fa48("439") ? false : stryMutAct_9fa48("438") ? true : (stryCov_9fa48("438", "439", "440"), frame && (stryMutAct_9fa48("442") ? frame.containerType !== "array" : stryMutAct_9fa48("441") ? true : (stryCov_9fa48("441", "442"), frame.containerType === (stryMutAct_9fa48("443") ? "" : (stryCov_9fa48("443"), "array")))))) {
        if (stryMutAct_9fa48("444")) {
          {}
        } else {
          stryCov_9fa48("444");
          stryMutAct_9fa48("445") ? frame.nextArrayIndex-- : (stryCov_9fa48("445"), frame.nextArrayIndex++);
        }
      }
    }
  }

  /**
   * Take accumulated diagnostics and clear.
   */
  takeDiagnostics(): Diagnostic[] {
    if (stryMutAct_9fa48("446")) {
      {}
    } else {
      stryCov_9fa48("446");
      const result = this.diagnostics;
      this.diagnostics = stryMutAct_9fa48("447") ? ["Stryker was here"] : (stryCov_9fa48("447"), []);
      return result;
    }
  }

  /**
   * Check if the stack is empty (no open containers).
   */
  isEmpty(): boolean {
    if (stryMutAct_9fa48("448")) {
      {}
    } else {
      stryCov_9fa48("448");
      return stryMutAct_9fa48("451") ? this.stack.length !== 0 : stryMutAct_9fa48("450") ? false : stryMutAct_9fa48("449") ? true : (stryCov_9fa48("449", "450", "451"), this.stack.length === 0);
    }
  }

  /**
   * Get all frames (for snapshot/pending info).
   */
  getFrames(): readonly GrammarFrame[] {
    if (stryMutAct_9fa48("452")) {
      {}
    } else {
      stryCov_9fa48("452");
      return this.stack;
    }
  }

  /**
   * Determine if all open containers can be safely closed by just appending '}' or ']'.
   * This is true if no container is waiting for a colon or a value.
   */
  canSafelyCloseAll(): boolean {
    if (stryMutAct_9fa48("453")) {
      {}
    } else {
      stryCov_9fa48("453");
      for (const frame of this.stack) {
        if (stryMutAct_9fa48("454")) {
          {}
        } else {
          stryCov_9fa48("454");
          if (stryMutAct_9fa48("457") ? frame.containerType !== "object" : stryMutAct_9fa48("456") ? false : stryMutAct_9fa48("455") ? true : (stryCov_9fa48("455", "456", "457"), frame.containerType === (stryMutAct_9fa48("458") ? "" : (stryCov_9fa48("458"), "object")))) {
            if (stryMutAct_9fa48("459")) {
              {}
            } else {
              stryCov_9fa48("459");
              if (stryMutAct_9fa48("462") ? (frame.objectExpectation === "colon" || frame.objectExpectation === "value") && frame.objectExpectation === "key_after_comma" : stryMutAct_9fa48("461") ? false : stryMutAct_9fa48("460") ? true : (stryCov_9fa48("460", "461", "462"), (stryMutAct_9fa48("464") ? frame.objectExpectation === "colon" && frame.objectExpectation === "value" : stryMutAct_9fa48("463") ? false : (stryCov_9fa48("463", "464"), (stryMutAct_9fa48("466") ? frame.objectExpectation !== "colon" : stryMutAct_9fa48("465") ? false : (stryCov_9fa48("465", "466"), frame.objectExpectation === (stryMutAct_9fa48("467") ? "" : (stryCov_9fa48("467"), "colon")))) || (stryMutAct_9fa48("469") ? frame.objectExpectation !== "value" : stryMutAct_9fa48("468") ? false : (stryCov_9fa48("468", "469"), frame.objectExpectation === (stryMutAct_9fa48("470") ? "" : (stryCov_9fa48("470"), "value")))))) || (stryMutAct_9fa48("472") ? frame.objectExpectation !== "key_after_comma" : stryMutAct_9fa48("471") ? false : (stryCov_9fa48("471", "472"), frame.objectExpectation === (stryMutAct_9fa48("473") ? "" : (stryCov_9fa48("473"), "key_after_comma")))))) {
                if (stryMutAct_9fa48("474")) {
                  {}
                } else {
                  stryCov_9fa48("474");
                  return stryMutAct_9fa48("475") ? true : (stryCov_9fa48("475"), false); // Missing colon or value or key
                }
              }
            }
          } else {
            if (stryMutAct_9fa48("476")) {
              {}
            } else {
              stryCov_9fa48("476");
              if (stryMutAct_9fa48("479") ? frame.arrayExpectation !== "value_after_comma" : stryMutAct_9fa48("478") ? false : stryMutAct_9fa48("477") ? true : (stryCov_9fa48("477", "478", "479"), frame.arrayExpectation === (stryMutAct_9fa48("480") ? "" : (stryCov_9fa48("480"), "value_after_comma")))) {
                if (stryMutAct_9fa48("481")) {
                  {}
                } else {
                  stryCov_9fa48("481");
                  return stryMutAct_9fa48("482") ? true : (stryCov_9fa48("482"), false); // Missing value after comma
                }
              }
            }
          }
        }
      }
      return stryMutAct_9fa48("483") ? false : (stryCov_9fa48("483"), true);
    }
  }
}