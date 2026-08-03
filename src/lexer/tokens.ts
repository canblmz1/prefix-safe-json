// ---------------------------------------------------------------------------
// Lexer token types
// ---------------------------------------------------------------------------

export const enum TokenType {
  // Structural
  ObjectStart = 1,   // {
  ObjectEnd = 2,     // }
  ArrayStart = 3,    // [
  ArrayEnd = 4,      // ]
  Colon = 5,         // :
  Comma = 6,         // ,

  // Values
  String = 10,       // completed string value
  Number = 11,       // completed number value
  True = 12,
  False = 13,
  Null = 14,

  // Signals
  Error = 90,        // irrecoverable scan error
}

/** A token emitted by the scanner. */
export interface Token {
  type: TokenType;
  value: string;          // the decoded value (for strings: unescaped content; for numbers: raw text)
  byteStart: number;      // absolute byte offset of token start
  byteEnd: number;        // absolute byte offset past token end
}
