import { describe, it, expect } from "vitest";
import { createParser } from "../../src/parser.js";
import { createToolCallStreamCoordinator } from "../../src/coordinator/coordinator.js";
import type { NormalizedToolStreamEvent } from "../../src/coordinator/protocol.js";
import type { JsonObject, StreamEndReason } from "../../src/types.js";

describe("Parser Regressions", () => {
  const invalidInputs = [
    "[1 2]",
    "[true false]",
    '["a" "b"]',
    "[{} {}]",
    "[[] []]",
    "[1,]",
    "[true,]",
    "[{},]",
    '{"a":1,}',
    '{"a":{},}',
  ];

  for (const input of invalidInputs) {
    it(`rejects invalid input: ${input}`, () => {
      const parser = createParser();
      parser.push(input);
      parser.finish({ reason: "complete" });

      const snapshot = parser.snapshot();
      expect(["invalid", "incomplete"]).toContain(snapshot.syntax);
      expect(snapshot.executable).toBe(false);

      const hasError = snapshot.diagnostics.some(d => d.severity === "error" || d.severity === "fatal");
      expect(hasError).toBe(true);
    });
  }
});

describe("Hostile audit fixes", () => {
  it("decoder: does not crash on a single push over ~130KB", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 1_000_000 } });
    const bigString = "x".repeat(200_000);
    const payload = `{"a":"${bigString}"}`;

    expect(() => parser.push(payload)).not.toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect((result.stableValue as JsonObject).a).toHaveLength(200_000);
  });

  it("decoder: does not crash on a single Uint8Array push over ~130KB", () => {
    const parser = createParser({ limits: { maxQueuedEvents: 1_000_000 } });
    const bigString = "y".repeat(200_000);
    const bytes = new TextEncoder().encode(`{"a":"${bigString}"}`);

    expect(() => parser.push(bytes)).not.toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
  });

  it("__proto__: is preserved as a real own property, not silently dropped", () => {
    const parser = createParser();
    parser.push('{"__proto__": "hello", "safe": 1}');
    const result = parser.finish({ reason: "complete" });

    const value = result.stableValue as JsonObject;
    expect(Object.prototype.hasOwnProperty.call(value, "__proto__")).toBe(true);
    expect(Object.getOwnPropertyDescriptor(value, "__proto__")?.value).toBe("hello");
    expect(value.safe).toBe(1);
    expect(Object.keys(value).sort()).toEqual(["__proto__", "safe"]);
    // Compare against native JSON.parse's own output rather than a
    // hand-written `{ __proto__: "hello" }` object literal — the literal
    // shorthand form is itself special-cased by the JS spec to *set the
    // prototype* rather than create an own property, and silently no-ops
    // for a non-object value like "hello". JSON.parse doesn't have that
    // problem (it uses CreateDataProperty), so it's a safe reference here.
    expect(JSON.stringify(value)).toBe(
      JSON.stringify(JSON.parse('{"__proto__":"hello","safe":1}')),
    );
    // Must not escalate to real prototype pollution either.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("__proto__: nested under a key does not leak into the global prototype", () => {
    const before = ({} as Record<string, unknown>).polluted;
    const parser = createParser();
    parser.push('{"a":{"__proto__":{"polluted":"yes"}}}');
    const result = parser.finish({ reason: "complete" });

    expect(({} as Record<string, unknown>).polluted).toBe(before);
    const a = (result.stableValue as JsonObject).a as JsonObject;
    expect(Object.getOwnPropertyDescriptor(a, "__proto__")?.value).toEqual({
      polluted: "yes",
    });
  });

  it("deepClone: snapshot() does not crash at nesting depth 6000", () => {
    const DEPTH = 6000;
    const parser = createParser({ limits: { maxDepth: 100_000 } });
    parser.push('{"a":'.repeat(DEPTH) + "1" + "}".repeat(DEPTH));

    expect(() => parser.snapshot()).not.toThrow();
  });

  it("deepClone: finish() does not crash at nesting depth 6000", () => {
    const DEPTH = 6000;
    const parser = createParser({ limits: { maxDepth: 100_000 } });
    parser.push('{"a":'.repeat(DEPTH) + "1" + "}".repeat(DEPTH));

    expect(() => parser.finish({ reason: "complete" })).not.toThrow();
  });

  it("pointer construction: opening 6000 nested unclosed arrays stays fast", () => {
    const DEPTH = 6000;
    const parser = createParser({
      limits: { maxDepth: 100_000, maxQueuedEvents: 1_000_000 },
    });

    const start = performance.now();
    parser.push("[".repeat(DEPTH));
    const elapsedMs = performance.now() - start;

    // Pre-fix (O(n^2) eager path materialization) this took multiple
    // seconds at this depth; post-fix it's a handful of milliseconds.
    expect(elapsedMs).toBeLessThan(1500);
  }, 20_000);

  it("diagnostics: allDiagnostics/allRepairs stay bounded even when drained after every push", () => {
    const CAP = 50;
    const parser = createParser({ limits: { maxQueuedEvents: CAP } });

    parser.push('{"a":1');
    parser.drainEvents();

    // Each of these repeats registers one E_DUPLICATE_KEY diagnostic. A
    // consumer draining events after every push keeps the live event queue
    // short, which must not let the diagnostics/repairs history grow past
    // the configured cap regardless.
    for (let i = 0; i < CAP * 4; i++) {
      parser.push(',"a":1');
      parser.drainEvents();
    }
    parser.push("}");
    parser.drainEvents();

    const result = parser.finish({ reason: "complete" });
    expect(result.diagnostics.length).toBeLessThanOrEqual(CAP);
  });

  it("outcome/executable stay correct when the repairs array is saturated before a structural repair occurs", () => {
    // Regression: determineOutcome() and isExecutable() used to re-derive
    // "was there ever a structural repair / R_CLOSE_CONTAINER repair" by
    // scanning allRepairs — which the maxQueuedEvents cap can truncate. If
    // enough representation_preserving repairs (e.g. escaped raw control
    // characters) filled the cap before a later closeContainersAtFinish
    // salvage occurred, the salvage repair itself would be silently dropped
    // from the array, and outcome incorrectly reported "valid" instead of
    // "salvaged" for a stream that was actually truncated and only survived
    // via structural salvage.
    const CAP = 10;
    const parser = createParser({
      limits: { maxQueuedEvents: CAP, maxDepth: 100 },
      repairs: { rawControlCharacters: "escape", closeContainersAtFinish: "safe-only" },
    });

    parser.push('{"a":"');
    parser.drainEvents();
    for (let i = 0; i < CAP + 5; i++) {
      parser.push("\x01"); // each produces one representation_preserving repair
      parser.drainEvents();
    }
    parser.push('","b":true ');
    parser.drainEvents();

    const result = parser.finish({ reason: "length" }); // truncated -> triggers safe-only salvage

    expect(result.repairs.length).toBeLessThanOrEqual(CAP); // array is still capped
    expect(result.outcome).toBe("salvaged"); // but outcome is correct regardless
    expect(result.executable).toBe(false);
  });

  it("number grammar: rejects a leading zero ('01')", () => {
    const parser = createParser();
    parser.push("01");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a leading zero inside an object ('{\"a\":01}')", () => {
    const parser = createParser();
    parser.push('{"a":01}');
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a trailing decimal point ('1.')", () => {
    const parser = createParser();
    parser.push("1.");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: rejects a truncated exponent ('1e+') at stream end", () => {
    const parser = createParser();
    parser.push("1e+");
    const result = parser.finish({ reason: "complete" });

    expect(result.outcome).not.toBe("valid");
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("number grammar: bare top-level malformed number is 'invalid', not 'truncated' - same category as the wrapped case", () => {
    // Regression: a definitively malformed number (leading zero, trailing
    // "."/exponent) can never become valid no matter what more data
    // arrives - unlike a genuine truncation (e.g. "123" cut off mid-stream),
    // which could resolve into a valid number with more digits. The
    // "invalid" branch of finish()'s number-finalization handling emitted
    // a diagnostic but never set terminal/syntax_ (every other error branch
    // in the file does), so determineOutcome() fell through to its generic
    // `!rootComplete` case and mislabeled it "truncated". Only reproduced
    // for a BARE top-level number: `{"a":01}` already correctly reported
    // "invalid" via a different code path (the scanner's own
    // ScannerState.Invalid transition), which is exactly why the
    // pre-existing `.not.toBe("valid")` assertions above (true for both
    // "invalid" and "truncated") never caught this for 10 audit rounds.
    for (const doc of ["01", "-01", "-00", "1.", "-1.", "1e+"]) {
      const parser = createParser();
      parser.push(doc);
      const result = parser.finish({ reason: "complete" });

      expect(result.outcome, `input ${doc}`).toBe("invalid");
      expect(result.executable, `input ${doc}`).toBe(false);
    }
  });

  it("number grammar: genuine truncation (incomplete number, stream ended early) still reports 'truncated'", () => {
    const parser = createParser();
    parser.push("123");
    const result = parser.finish({ reason: "length" });

    expect(result.outcome).toBe("truncated");
    expect(result.executable).toBe(false);
  });

  it("number grammar: still accepts valid numbers unaffected by the fix", () => {
    const cases: Array<[string, number]> = [
      ["0", 0],
      ["0.5", 0.5],
      ["-0", -0],
      ["1e400", Infinity],
      ["-1", -1],
      ["1.5e10", 1.5e10],
    ];
    for (const [text, expected] of cases) {
      const parser = createParser();
      parser.push(text);
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome, `input ${text}`).toBe("valid");
      expect(result.stableValue, `input ${text}`).toBe(expected);
    }
  });

  it("maxStringBytes: enforced when configured", () => {
    const parser = createParser({ limits: { maxStringBytes: 10 } });
    parser.push('{"a":"this string is much longer than ten bytes"}');

    const snapshot = parser.snapshot();
    expect(snapshot.syntax).toBe("invalid");
    expect(
      snapshot.diagnostics.some((d) => d.code === "E_LIMIT_STRING_BYTES"),
    ).toBe(true);
  });

  it("maxStringBytes: a string of exactly the configured length is allowed (off-by-one)", () => {
    // Regression: the length check ran on the closing quote character too,
    // counting it as one extra content byte, so a 5-byte string with
    // maxStringBytes:5 was wrongly rejected.
    const exactly = createParser({ limits: { maxStringBytes: 5 } });
    exactly.push('{"a":"12345"}');
    const exactResult = exactly.finish({ reason: "complete" });
    expect(exactResult.outcome).toBe("valid");
    expect(exactResult.stableValue).toEqual({ a: "12345" });

    const oneOver = createParser({ limits: { maxStringBytes: 5 } });
    oneOver.push('{"a":"123456"}');
    const overResult = oneOver.finish({ reason: "complete" });
    expect(overResult.outcome).not.toBe("valid");
  });

  it("maxStringBytes: an all-backslash-escape string still can't bypass the limit", () => {
    // Regression-adjacent: confirms the closing-quote exemption above didn't
    // accidentally also exempt the backslash-starts-an-escape branch, which
    // would let a string made entirely of escapes grow unbounded.
    const parser = createParser({
      limits: { maxStringBytes: 20, maxQueuedEvents: 1_000_000 },
    });
    const payload = '{"a":"' + "\\\\".repeat(500) + '"}'; // 1000 raw bytes
    const r = parser.push(payload);
    expect(r.terminal).toBe(true);
  });

  it("maxStringBytes: short strings under the limit are unaffected", () => {
    const parser = createParser({ limits: { maxStringBytes: 10 } });
    parser.push('{"a":"ok"}');
    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect((result.stableValue as JsonObject).a).toBe("ok");
  });

  it("coordinator: parserOptions passed to the factory reach the underlying parser", () => {
    const coord = createToolCallStreamCoordinator(undefined, {
      limits: { maxDepth: 2 },
    });
    const callRef = { internalId: "id0" };
    coord.push({
      type: "tool_call_start",
      callRef,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    // Three levels of nesting — over the configured maxDepth of 2.
    coord.push({
      type: "tool_call_arguments_delta",
      callRef,
      toolIndex: 0,
      delta: '{"a":{"b":{"c":1',
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call).toBeDefined();
    expect(
      call?.parser.diagnostics.some((d) => d.code === "E_LIMIT_DEPTH"),
    ).toBe(true);
  });

  it("coordinator: omitting parserOptions still works with library defaults", () => {
    const coord = createToolCallStreamCoordinator();
    const callRef = { internalId: "id0" };
    coord.push({
      type: "tool_call_start",
      callRef,
      toolIndex: 0,
      provider: "openai",
    } as unknown as NormalizedToolStreamEvent);
    coord.push({
      type: "tool_call_arguments_delta",
      callRef,
      toolIndex: 0,
      delta: '{"a":{"b":{"c":1}}}',
    } as unknown as NormalizedToolStreamEvent);

    const call = coord.snapshot().calls[0];
    expect(call?.parser.diagnostics.some((d) => d.code === "E_LIMIT_DEPTH")).toBe(
      false,
    );
  });
});

describe("Round 10 audit fixes", () => {
  it("executable is false whenever outcome is invalid, even when the event queue caps out exactly at root completion", () => {
    // Regression: EventBuilder's own event-queue-capacity cutoff (see
    // semantic/builder.ts's enqueue()) sets parser-level terminal/syntax_
    // state directly, bypassing addDiagnostic() entirely - so it never set
    // everHadFatalDiagnostic, and isExecutable() (which only checked
    // hasFatalDiagnostic()/hasNonRecoverableError()/repair flags, never
    // terminal/syntax_ itself) returned true for a stream determineOutcome()
    // simultaneously and correctly reported as "invalid". Narrow window:
    // only reproduces when the queue fills on the *last* event or two of a
    // stream (root completion races the cutoff) - a document with many more
    // elements past the cap instead truncates mid-stream and was already
    // handled correctly via E_STREAM_TRUNCATED.
    const CAP = 10;
    for (const n of [10, 11]) {
      const parser = createParser({ limits: { maxQueuedEvents: CAP } });
      const arr = "[" + Array(n).fill("1").join(",") + "]";
      parser.push(arr);
      const result = parser.finish({ reason: "complete" });

      expect(result.outcome, `n=${n}`).toBe("invalid");
      expect(result.executable, `n=${n}`).toBe(false);
    }
  });

  it("executable/outcome stay consistent (both valid) just under the same boundary", () => {
    const CAP = 10;
    for (const n of [8, 9]) {
      const parser = createParser({ limits: { maxQueuedEvents: CAP } });
      const arr = "[" + Array(n).fill("1").join(",") + "]";
      parser.push(arr);
      const result = parser.finish({ reason: "complete" });

      expect(result.outcome, `n=${n}`).toBe("valid");
      expect(result.executable, `n=${n}`).toBe(true);
    }
  });
});

describe("Round 12 audit fixes", () => {
  it("diagnostic/repair objects returned by snapshot()/finish() are frozen and can't corrupt later results", () => {
    // Regression: snapshot()/finish() froze the ARRAY they return
    // (Object.freeze([...this.allDiagnostics])) but not each element -
    // those were the same object references stored internally. A consumer
    // mutating a field on a returned diagnostic/repair object silently
    // corrupted the parser's own history, visible in every later
    // snapshot()/finish() call.
    const parser = createParser({ limits: { maxStringBytes: 3 } });
    parser.push('{"a":"toolong"');
    const snap = parser.snapshot();

    expect(snap.diagnostics.length).toBeGreaterThan(0);
    expect(() => {
      (snap.diagnostics[0] as { message: string }).message = "HACKED";
    }).toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.diagnostics[0]?.message).not.toBe("HACKED");
  });

  it("repair objects are frozen too, including the nested byteRange tuple", () => {
    const parser = createParser();
    parser.push("﻿"); // triggers R_STRIP_UTF8_BOM
    parser.push('{"a":1}');
    const snap = parser.snapshot();

    expect(snap.repairs.length).toBeGreaterThan(0);
    expect(() => {
      (snap.repairs[0] as { description: string }).description = "HACKED";
    }).toThrow();
    expect(() => {
      (snap.repairs[0]?.byteRange as unknown as number[])[0] = 999;
    }).toThrow();

    const result = parser.finish({ reason: "complete" });
    expect(result.repairs[0]?.description).not.toBe("HACKED");
  });

  it("non-finite limit values (NaN) fall back to the default instead of silently disabling the limit", () => {
    // Regression: `userLimits.maxDepth ?? DEFAULT_LIMITS.maxDepth` only
    // rejects null/undefined - NaN passes straight through, and every
    // limit check in the codebase is a plain `>`/`>=` comparison, which is
    // always false against NaN. A NaN limit (e.g. from a caller's own
    // division-by-zero bug while computing it) silently disabled that
    // resource limit entirely, with no error and no warning.
    const withDefault = createParser({ limits: { maxDepth: 128 } });
    withDefault.push("[".repeat(200) + "1" + "]".repeat(200));
    const rDefault = withDefault.finish({ reason: "complete" });

    const withNaN = createParser({ limits: { maxDepth: NaN } });
    withNaN.push("[".repeat(200) + "1" + "]".repeat(200));
    const rNaN = withNaN.finish({ reason: "complete" });

    expect(rNaN.outcome).toBe(rDefault.outcome);
    expect(rNaN.outcome).toBe("invalid");
  });
});

describe("numberGrammarError — each disqualifying case, with the exact raw diagnostic text", () => {
  // numberGrammarError()'s return value is surfaced verbatim as the
  // diagnostic message ONLY on the mid-stream termination path
  // (commitNumber(), when a delimiter ends the number before end-of-input)
  // - verified directly: at true stream end, finalizeNumber() instead
  // wraps it into a generic "Invalid number at stream end: <buffer>"
  // message and discards the specific text entirely. Delimiter-terminated
  // ("[<number>,2]") inputs below exercise the path where the exact
  // message is genuinely observable.
  const cases: Array<{ label: string; input: string; message: string }> = [
    { label: "trailing '.'", input: "[1.,2]", message: "Number has trailing decimal point with no digits" },
    { label: "trailing '+' after exponent", input: "[1e+,2]", message: "Number has exponent with no digits" },
    { label: "trailing '-' after exponent", input: "[1e-,2]", message: "Number has exponent with no digits" },
    { label: "leading zero", input: "[01,2]", message: "Number has leading zero" },
    { label: "negative leading zero", input: "[-01,2]", message: "Number has leading zero" },
  ];

  for (const { label, input, message } of cases) {
    it(`${label} ('${input}') is rejected as invalid with the exact expected diagnostic message`, () => {
      const parser = createParser();
      parser.push(input);
      const result = parser.finish({ reason: "complete" });

      expect(result.outcome).toBe("invalid");
      expect(result.executable).toBe(false);
      expect(result.diagnostics.some((d) => d.message === message)).toBe(true);
    });
  }

  it("bare trailing 'e'/'E' with nothing after at true stream end is genuinely truncated, not a grammar violation - contrast case", () => {
    // Distinguishes "not_ready" (finalizeNumber's third outcome, per its
    // own docstring: "ends right at a bare e/E with no sign or digit yet")
    // from "invalid": unlike a trailing sign ('1e+'), a bare trailing "e"
    // could still become a valid number ("1e5") with more input, so it's
    // not yet diagnosable as malformed.
    for (const input of ["1e", "1E", "-"]) {
      const parser = createParser();
      parser.push(input);
      const result = parser.finish({ reason: "complete" });
      expect(result.outcome).toBe("truncated");
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("a bare 'e' immediately followed by a delimiter hits the state machine's own terminator check, not numberGrammarError", () => {
    // A third, distinct diagnostic path: '[1e,2]' never reaches
    // commitNumber()'s numberGrammarError() call at all - the
    // NumberExponentStart state's own terminator branch rejects it first
    // (see scanner.ts's comment on commitNumber: "trailing exponent-with-
    // no-digit is already rejected before calling this").
    const parser = createParser();
    parser.push("[1e,2]");
    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("invalid");
    expect(
      result.diagnostics.some((d) => d.message.startsWith("Expected digit or sign after exponent")),
    ).toBe(true);
  });

  it("a lone zero ('0') is NOT a leading-zero violation - single-digit zero is valid JSON", () => {
    const parser = createParser();
    parser.push("0");
    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect(result.executable).toBe(true);
    expect(result.stableValue).toBe(0);
  });

  it("'0.5' (zero followed by a fraction, not another integer digit) is valid - not a leading-zero violation", () => {
    const parser = createParser();
    parser.push("0.5");
    const result = parser.finish({ reason: "complete" });
    expect(result.outcome).toBe("valid");
    expect(result.stableValue).toBe(0.5);
  });

  it("chunk invariance: every 2-way split of a well-formed number produces the identical stableValue", () => {
    const whole = "-123.456e+7";
    for (let i = 1; i < whole.length; i++) {
      const p = createParser();
      p.push(whole.slice(0, i));
      p.push(whole.slice(i));
      const r = p.finish({ reason: "complete" });
      expect(r.outcome).toBe("valid");
      expect(r.stableValue).toBe(-123.456e7);
    }
  });
});

describe("isExecutable() must allowlist reason:'complete', not denylist known-bad reasons", () => {
  // isExecutable() used to deny exactly five known StreamEndReason values
  // ("length"/"network_error"/"provider_error"/"cancelled"/"unknown") and
  // fall through to executable:true for anything else. StreamEndReason is a
  // closed TypeScript union, so a well-typed caller can never construct the
  // gap this leaves - but finish()'s `reason` is never validated at
  // runtime, and real callers (provider adapters normalizing a raw
  // finish_reason/stop_reason string from an LLM API, or any caller that
  // bypasses the type checker) can and do pass strings outside that union.
  // An unrecognized reason must never be silently treated as "safe" -
  // "complete" is the only reason that means the stream genuinely finished
  // normally, so only that one should ever unlock executable:true.
  it("an unrecognized/unmapped stream-end reason string does NOT make an otherwise-valid stream executable", () => {
    const p = createParser();
    p.push('{"a":1}');
    const r = p.finish({
      reason: "some_unmapped_provider_reason" as unknown as StreamEndReason,
    });
    expect(r.outcome).toBe("valid"); // syntactically fine
    expect(r.executable).toBe(false); // but never confirmed complete - must not execute
  });

  it("contrast: the same JSON with the genuine reason:'complete' IS executable", () => {
    const p = createParser();
    p.push('{"a":1}');
    const r = p.finish({ reason: "complete" });
    expect(r.executable).toBe(true);
  });

  it("an empty-string reason (another value outside the union) does NOT make an otherwise-valid stream executable", () => {
    const p = createParser();
    p.push('{"a":1}');
    const r = p.finish({ reason: "" as unknown as StreamEndReason });
    expect(r.executable).toBe(false);
  });
});
