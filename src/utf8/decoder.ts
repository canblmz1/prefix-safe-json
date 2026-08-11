// ---------------------------------------------------------------------------
// Incremental UTF-8 Decoder
// ---------------------------------------------------------------------------
//
// Processes Uint8Array chunks and yields code points one at a time.
// Handles multi-byte characters split across chunk boundaries by buffering
// incomplete trailing bytes until the next push().
//
// Design decisions:
//   - Does NOT silently replace invalid bytes with U+FFFD
//   - Rejects overlong encodings
//   - Reports invalid continuation bytes
//   - Truncated sequences at finish() are reportable
// ---------------------------------------------------------------------------

/** Result of decoding a chunk of bytes. */
export interface DecodeResult {
  /** Decoded code points as a string. */
  text: string;
  /** Number of bytes consumed (may be less than input if trailing incomplete sequence). */
  consumed: number;
  /** Errors encountered during decoding. */
  errors: Utf8Error[];
  /** True if BOM was detected and stripped during this chunk. */
  strippedBom: boolean;
}

export interface Utf8Error {
  kind:
    | "invalid_start_byte"
    | "invalid_continuation"
    | "overlong"
    | "out_of_range";
  byteOffset: number;
}

/**
 * Incremental UTF-8 decoder that handles multi-byte characters
 * split across chunk boundaries.
 */
export class Utf8Decoder {
  /** Pending bytes from an incomplete multi-byte sequence. */
  private pending: number[] = [];
  /** Expected total length of the current multi-byte sequence. */
  private pendingExpected = 0;
  /** Total bytes processed across all push() calls. */
  private totalOffset = 0;
  
  private bomBuffer: number[] = [];
  private checkedForBom = false;

  /**
   * Decode a chunk of bytes, returning decoded text and any errors.
   * Incomplete trailing multi-byte sequences are buffered for the next call.
   */
  decode(bytes: Uint8Array): DecodeResult {
    const errors: Utf8Error[] = [];
    const codePoints: number[] = [];
    let strippedBom = false;
    let i = 0;

    // Handle BOM check at the very beginning of the stream
    if (!this.checkedForBom) {
      while (this.bomBuffer.length < 3 && i < bytes.length) {
        this.bomBuffer.push(bytes[i] as number);
        i++;
      }

      const isBomPrefix =
        (this.bomBuffer[0] === 0xef) &&
        (this.bomBuffer.length < 2 || this.bomBuffer[1] === 0xbb) &&
        (this.bomBuffer.length < 3 || this.bomBuffer[2] === 0xbf);

      if (isBomPrefix && this.bomBuffer.length < 3) {
        // Still possibly a BOM, wait for more data
        return { text: "", consumed: i, errors, strippedBom: false };
      }

      this.checkedForBom = true;
      let bufferToProcess = new Uint8Array();

      if (
        this.bomBuffer.length >= 3 &&
        this.bomBuffer[0] === 0xef &&
        this.bomBuffer[1] === 0xbb &&
        this.bomBuffer[2] === 0xbf
      ) {
        strippedBom = true;
        this.totalOffset += 3;
        // The remaining bytes in bomBuffer (if any) need to be processed
        const remainingInBomBuffer = this.bomBuffer.slice(3);
        const remainingInBytes = bytes.slice(i);
        bufferToProcess = new Uint8Array(remainingInBomBuffer.length + remainingInBytes.length);
        bufferToProcess.set(remainingInBomBuffer);
        bufferToProcess.set(remainingInBytes, remainingInBomBuffer.length);
      } else {
        // Not a BOM. Process the whole bomBuffer + remaining bytes.
        const remainingInBytes = bytes.slice(i);
        bufferToProcess = new Uint8Array(this.bomBuffer.length + remainingInBytes.length);
        bufferToProcess.set(this.bomBuffer);
        bufferToProcess.set(remainingInBytes, this.bomBuffer.length);
      }
      
      // Reset i and swap bytes to the reconstructed buffer
      i = 0;
      bytes = bufferToProcess;
    }

    const startOffset = this.totalOffset;

    // If we have pending bytes from a previous chunk, try to complete the sequence
    if (this.pending.length > 0) {
      let brokenByInvalidContinuation = false;
      while (i < bytes.length && this.pending.length < this.pendingExpected) {
        const b = bytes[i] as number;
        if ((b & 0xc0) !== 0x80) {
          // Not a valid continuation byte — the pending sequence is broken
          errors.push({
            kind: "invalid_continuation",
            byteOffset: startOffset - this.pending.length,
          });
          this.pending = [];
          this.pendingExpected = 0;
          brokenByInvalidContinuation = true;
          // Don't consume this byte — it might be a valid start byte
          break;
        }
        this.pending.push(b);
        i++;
        this.totalOffset++;
      }

      // brokenByInvalidContinuation resets pending.length/pendingExpected to
      // the same value (0), which would otherwise make the check below
      // read as "0 of 0 bytes needed - sequence complete" and spuriously
      // decode an empty byte array, producing a second, bogus diagnostic
      // alongside the invalid_continuation one already pushed above.
      if (!brokenByInvalidContinuation && this.pending.length === this.pendingExpected) {
        // We have a complete sequence — decode it
        const result = this.decodeSequence(
          this.pending,
          startOffset - (this.pending.length - (i - 0)),
        );
        if (result.error) {
          errors.push(result.error);
        } else {
          codePoints.push(result.codePoint);
        }
        this.pending = [];
        this.pendingExpected = 0;
      } else if (!brokenByInvalidContinuation && i >= bytes.length) {
        // Still incomplete — wait for more data
        const consumed = this.totalOffset - startOffset;
        return { text: "", consumed, errors, strippedBom };
      }
    }

    // Process remaining bytes
    while (i < bytes.length) {
      const b = bytes[i] as number;
      const seqOffset = this.totalOffset;

      if (b <= 0x7f) {
        // Single-byte ASCII
        codePoints.push(b);
        i++;
        this.totalOffset++;
      } else if ((b & 0xe0) === 0xc0) {
        // 2-byte sequence
        const needed = 2;
        if (i + needed <= bytes.length) {
          const seq = [b, bytes[i + 1] as number];
          const result = this.decodeSequence(seq, seqOffset);
          if (result.error) {
            errors.push(result.error);
            i++;
            this.totalOffset++;
          } else {
            codePoints.push(result.codePoint);
            i += needed;
            this.totalOffset += needed;
          }
        } else {
          // Incomplete at end of chunk — buffer it
          this.pendingExpected = needed;
          this.pending = [];
          for (let j = i; j < bytes.length; j++) {
            this.pending.push(bytes[j] as number);
          }
          this.totalOffset += bytes.length - i;
          i = bytes.length;
        }
      } else if ((b & 0xf0) === 0xe0) {
        // 3-byte sequence
        const needed = 3;
        if (i + needed <= bytes.length) {
          const seq = [b, bytes[i + 1] as number, bytes[i + 2] as number];
          const result = this.decodeSequence(seq, seqOffset);
          if (result.error) {
            errors.push(result.error);
            i++;
            this.totalOffset++;
          } else {
            codePoints.push(result.codePoint);
            i += needed;
            this.totalOffset += needed;
          }
        } else {
          this.pendingExpected = needed;
          this.pending = [];
          for (let j = i; j < bytes.length; j++) {
            this.pending.push(bytes[j] as number);
          }
          this.totalOffset += bytes.length - i;
          i = bytes.length;
        }
      } else if ((b & 0xf8) === 0xf0) {
        // 4-byte sequence
        const needed = 4;
        if (i + needed <= bytes.length) {
          const seq = [b, bytes[i + 1] as number, bytes[i + 2] as number, bytes[i + 3] as number];
          const result = this.decodeSequence(seq, seqOffset);
          if (result.error) {
            errors.push(result.error);
            i++;
            this.totalOffset++;
          } else {
            codePoints.push(result.codePoint);
            i += needed;
            this.totalOffset += needed;
          }
        } else {
          this.pendingExpected = needed;
          this.pending = [];
          for (let j = i; j < bytes.length; j++) {
            this.pending.push(bytes[j] as number);
          }
          this.totalOffset += bytes.length - i;
          i = bytes.length;
        }
      } else {
        // Invalid start byte (0x80-0xBF or 0xF8+)
        errors.push({
          kind: "invalid_start_byte",
          byteOffset: seqOffset,
        });
        i++;
        this.totalOffset++;
      }
    }

    const text = codePointsToString(codePoints);
    const consumed = this.totalOffset - startOffset;
    return { text, consumed, errors, strippedBom };
  }

  /**
   * Check if there are buffered incomplete bytes.
   */
  hasIncomplete(): boolean {
    return this.pending.length > 0;
  }

  /**
   * Get the byte offset where the incomplete sequence started.
   */
  incompleteByteOffset(): number {
    return this.totalOffset - this.pending.length;
  }


  /**
   * Decode a complete multi-byte UTF-8 sequence into a code point.
   * Returns an error for invalid continuation, overlong, or out-of-range sequences.
   */
  private decodeSequence(
    seq: number[],
    offset: number,
  ): { codePoint: number; error?: undefined } | { codePoint: number; error: Utf8Error } {
    const len = seq.length;

    // Validate continuation bytes
    for (let i = 1; i < len; i++) {
      if (((seq[i] as number) & 0xc0) !== 0x80) {
        return {
          codePoint: 0,
          error: { kind: "invalid_continuation", byteOffset: offset },
        };
      }
    }

    let codePoint: number;
    let minCodePoint: number;

    if (len === 2) {
      codePoint = (((seq[0] as number) & 0x1f) << 6) | ((seq[1] as number) & 0x3f);
      minCodePoint = 0x80;
    } else if (len === 3) {
      codePoint =
        (((seq[0] as number) & 0x0f) << 12) |
        (((seq[1] as number) & 0x3f) << 6) |
        ((seq[2] as number) & 0x3f);
      minCodePoint = 0x800;
    } else {
      // len === 4
      codePoint =
        (((seq[0] as number) & 0x07) << 18) |
        (((seq[1] as number) & 0x3f) << 12) |
        (((seq[2] as number) & 0x3f) << 6) |
        ((seq[3] as number) & 0x3f);
      minCodePoint = 0x10000;
    }

    // Check overlong encoding
    if (codePoint < minCodePoint) {
      return {
        codePoint: 0,
        error: { kind: "overlong", byteOffset: offset },
      };
    }

    // Check valid Unicode range. Surrogate halves (U+D800-U+DFFF) are not
    // valid Unicode scalar values and must never appear directly encoded in
    // UTF-8 (RFC 3629) - they exist only as a UTF-16 encoding artifact. A
    // 3-byte sequence can arithmetically land in this range (e.g. ED A0 80
    // decodes to U+D800) without tripping the overlong or >0x10FFFF checks,
    // so it needs its own check.
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      return {
        codePoint: 0,
        error: { kind: "out_of_range", byteOffset: offset },
      };
    }

    return { codePoint };
  }
}

/**
 * Build a string from an array of code points without spreading the whole
 * array as call arguments — a single-call spread hits engine argument-count
 * limits (RangeError: Maximum call stack size exceeded) once codePoints
 * grows past roughly 100k entries, which a single large push() can trigger.
 */
function codePointsToString(codePoints: number[]): string {
  const CHUNK_SIZE = 8192;
  if (codePoints.length <= CHUNK_SIZE) {
    return String.fromCodePoint(...codePoints);
  }
  let text = "";
  for (let i = 0; i < codePoints.length; i += CHUNK_SIZE) {
    text += String.fromCodePoint(...codePoints.slice(i, i + CHUNK_SIZE));
  }
  return text;
}

/**
 * Convert a string to its UTF-8 byte representation.
 * Utility for tests and string-mode push().
 */
export function stringToUtf8(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}
