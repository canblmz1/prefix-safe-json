// ---------------------------------------------------------------------------
// Lexer state enumeration
// ---------------------------------------------------------------------------

export const enum ScannerState {
  /** Expecting a structural character or value start. */
  Structural = 0,

  /** Inside a string (value or key). */
  InString = 2,

  /** After backslash inside a string. */
  Escape = 3,

  /** Reading \uXXXX hex digits. */
  UnicodeEscape = 4,

  /** After a high surrogate \uD800-\uDBFF, expecting \uDC00-\uDFFF. */
  UnicodeSurrogatePending = 5,

  /** Reading integer part of a number (possibly after minus sign). */
  NumberInteger = 6,

  /** Reading fraction digits after decimal point. */
  NumberFraction = 7,

  /** Just saw 'e' or 'E', expecting optional sign or digit. */
  NumberExponentStart = 8,

  /** Reading exponent digits. */
  NumberExponent = 9,

  /** Reading 'true' literal. */
  LiteralTrue = 10,

  /** Reading 'false' literal. */
  LiteralFalse = 11,

  /** Reading 'null' literal. */
  LiteralNull = 12,

  /** Irrecoverable error. */
  Invalid = 15,

  /** Parsing finished (after finish() called). */
  Finished = 16,
}
