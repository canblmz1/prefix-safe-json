// @ts-nocheck
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

/** Result of decoding a chunk of bytes. */function stryNS_9fa48() {
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
  kind: "invalid_start_byte" | "invalid_continuation" | "overlong" | "out_of_range";
  byteOffset: number;
}

/**
 * Incremental UTF-8 decoder that handles multi-byte characters
 * split across chunk boundaries.
 */
export class Utf8Decoder {
  /** Pending bytes from an incomplete multi-byte sequence. */
  private pending: number[] = stryMutAct_9fa48("3132") ? ["Stryker was here"] : (stryCov_9fa48("3132"), []);
  /** Expected total length of the current multi-byte sequence. */
  private pendingExpected = 0;
  /** Total bytes processed across all push() calls. */
  private totalOffset = 0;
  private bomBuffer: number[] = stryMutAct_9fa48("3133") ? ["Stryker was here"] : (stryCov_9fa48("3133"), []);
  private checkedForBom = stryMutAct_9fa48("3134") ? true : (stryCov_9fa48("3134"), false);

  /**
   * Decode a chunk of bytes, returning decoded text and any errors.
   * Incomplete trailing multi-byte sequences are buffered for the next call.
   */
  decode(bytes: Uint8Array): DecodeResult {
    if (stryMutAct_9fa48("3135")) {
      {}
    } else {
      stryCov_9fa48("3135");
      const errors: Utf8Error[] = stryMutAct_9fa48("3136") ? ["Stryker was here"] : (stryCov_9fa48("3136"), []);
      const codePoints: number[] = stryMutAct_9fa48("3137") ? ["Stryker was here"] : (stryCov_9fa48("3137"), []);
      let strippedBom = stryMutAct_9fa48("3138") ? true : (stryCov_9fa48("3138"), false);
      let i = 0;

      // Handle BOM check at the very beginning of the stream
      if (stryMutAct_9fa48("3141") ? false : stryMutAct_9fa48("3140") ? true : stryMutAct_9fa48("3139") ? this.checkedForBom : (stryCov_9fa48("3139", "3140", "3141"), !this.checkedForBom)) {
        if (stryMutAct_9fa48("3142")) {
          {}
        } else {
          stryCov_9fa48("3142");
          while (stryMutAct_9fa48("3144") ? this.bomBuffer.length < 3 || i < bytes.length : stryMutAct_9fa48("3143") ? false : (stryCov_9fa48("3143", "3144"), (stryMutAct_9fa48("3147") ? this.bomBuffer.length >= 3 : stryMutAct_9fa48("3146") ? this.bomBuffer.length <= 3 : stryMutAct_9fa48("3145") ? true : (stryCov_9fa48("3145", "3146", "3147"), this.bomBuffer.length < 3)) && (stryMutAct_9fa48("3150") ? i >= bytes.length : stryMutAct_9fa48("3149") ? i <= bytes.length : stryMutAct_9fa48("3148") ? true : (stryCov_9fa48("3148", "3149", "3150"), i < bytes.length)))) {
            if (stryMutAct_9fa48("3151")) {
              {}
            } else {
              stryCov_9fa48("3151");
              this.bomBuffer.push(bytes[i] as number);
              stryMutAct_9fa48("3152") ? i-- : (stryCov_9fa48("3152"), i++);
            }
          }
          const isBomPrefix = stryMutAct_9fa48("3155") ? this.bomBuffer[0] === 0xef && (this.bomBuffer.length < 2 || this.bomBuffer[1] === 0xbb) || this.bomBuffer.length < 3 || this.bomBuffer[2] === 0xbf : stryMutAct_9fa48("3154") ? false : stryMutAct_9fa48("3153") ? true : (stryCov_9fa48("3153", "3154", "3155"), (stryMutAct_9fa48("3157") ? this.bomBuffer[0] === 0xef || this.bomBuffer.length < 2 || this.bomBuffer[1] === 0xbb : stryMutAct_9fa48("3156") ? true : (stryCov_9fa48("3156", "3157"), (stryMutAct_9fa48("3159") ? this.bomBuffer[0] !== 0xef : stryMutAct_9fa48("3158") ? true : (stryCov_9fa48("3158", "3159"), this.bomBuffer[0] === 0xef)) && (stryMutAct_9fa48("3161") ? this.bomBuffer.length < 2 && this.bomBuffer[1] === 0xbb : stryMutAct_9fa48("3160") ? true : (stryCov_9fa48("3160", "3161"), (stryMutAct_9fa48("3164") ? this.bomBuffer.length >= 2 : stryMutAct_9fa48("3163") ? this.bomBuffer.length <= 2 : stryMutAct_9fa48("3162") ? false : (stryCov_9fa48("3162", "3163", "3164"), this.bomBuffer.length < 2)) || (stryMutAct_9fa48("3166") ? this.bomBuffer[1] !== 0xbb : stryMutAct_9fa48("3165") ? false : (stryCov_9fa48("3165", "3166"), this.bomBuffer[1] === 0xbb)))))) && (stryMutAct_9fa48("3168") ? this.bomBuffer.length < 3 && this.bomBuffer[2] === 0xbf : stryMutAct_9fa48("3167") ? true : (stryCov_9fa48("3167", "3168"), (stryMutAct_9fa48("3171") ? this.bomBuffer.length >= 3 : stryMutAct_9fa48("3170") ? this.bomBuffer.length <= 3 : stryMutAct_9fa48("3169") ? false : (stryCov_9fa48("3169", "3170", "3171"), this.bomBuffer.length < 3)) || (stryMutAct_9fa48("3173") ? this.bomBuffer[2] !== 0xbf : stryMutAct_9fa48("3172") ? false : (stryCov_9fa48("3172", "3173"), this.bomBuffer[2] === 0xbf)))));
          if (stryMutAct_9fa48("3176") ? isBomPrefix || this.bomBuffer.length < 3 : stryMutAct_9fa48("3175") ? false : stryMutAct_9fa48("3174") ? true : (stryCov_9fa48("3174", "3175", "3176"), isBomPrefix && (stryMutAct_9fa48("3179") ? this.bomBuffer.length >= 3 : stryMutAct_9fa48("3178") ? this.bomBuffer.length <= 3 : stryMutAct_9fa48("3177") ? true : (stryCov_9fa48("3177", "3178", "3179"), this.bomBuffer.length < 3)))) {
            if (stryMutAct_9fa48("3180")) {
              {}
            } else {
              stryCov_9fa48("3180");
              // Still possibly a BOM, wait for more data
              return stryMutAct_9fa48("3181") ? {} : (stryCov_9fa48("3181"), {
                text: stryMutAct_9fa48("3182") ? "Stryker was here!" : (stryCov_9fa48("3182"), ""),
                consumed: i,
                errors,
                strippedBom: stryMutAct_9fa48("3183") ? true : (stryCov_9fa48("3183"), false)
              });
            }
          }
          this.checkedForBom = stryMutAct_9fa48("3184") ? false : (stryCov_9fa48("3184"), true);
          let bufferToProcess = new Uint8Array();
          if (stryMutAct_9fa48("3187") ? this.bomBuffer.length >= 3 && this.bomBuffer[0] === 0xef && this.bomBuffer[1] === 0xbb || this.bomBuffer[2] === 0xbf : stryMutAct_9fa48("3186") ? false : stryMutAct_9fa48("3185") ? true : (stryCov_9fa48("3185", "3186", "3187"), (stryMutAct_9fa48("3189") ? this.bomBuffer.length >= 3 && this.bomBuffer[0] === 0xef || this.bomBuffer[1] === 0xbb : stryMutAct_9fa48("3188") ? true : (stryCov_9fa48("3188", "3189"), (stryMutAct_9fa48("3191") ? this.bomBuffer.length >= 3 || this.bomBuffer[0] === 0xef : stryMutAct_9fa48("3190") ? true : (stryCov_9fa48("3190", "3191"), (stryMutAct_9fa48("3194") ? this.bomBuffer.length < 3 : stryMutAct_9fa48("3193") ? this.bomBuffer.length > 3 : stryMutAct_9fa48("3192") ? true : (stryCov_9fa48("3192", "3193", "3194"), this.bomBuffer.length >= 3)) && (stryMutAct_9fa48("3196") ? this.bomBuffer[0] !== 0xef : stryMutAct_9fa48("3195") ? true : (stryCov_9fa48("3195", "3196"), this.bomBuffer[0] === 0xef)))) && (stryMutAct_9fa48("3198") ? this.bomBuffer[1] !== 0xbb : stryMutAct_9fa48("3197") ? true : (stryCov_9fa48("3197", "3198"), this.bomBuffer[1] === 0xbb)))) && (stryMutAct_9fa48("3200") ? this.bomBuffer[2] !== 0xbf : stryMutAct_9fa48("3199") ? true : (stryCov_9fa48("3199", "3200"), this.bomBuffer[2] === 0xbf)))) {
            if (stryMutAct_9fa48("3201")) {
              {}
            } else {
              stryCov_9fa48("3201");
              strippedBom = stryMutAct_9fa48("3202") ? false : (stryCov_9fa48("3202"), true);
              stryMutAct_9fa48("3203") ? this.totalOffset -= 3 : (stryCov_9fa48("3203"), this.totalOffset += 3);
              // The remaining bytes in bomBuffer (if any) need to be processed
              const remainingInBomBuffer = stryMutAct_9fa48("3204") ? this.bomBuffer : (stryCov_9fa48("3204"), this.bomBuffer.slice(3));
              const remainingInBytes = stryMutAct_9fa48("3205") ? bytes : (stryCov_9fa48("3205"), bytes.slice(i));
              bufferToProcess = new Uint8Array(stryMutAct_9fa48("3206") ? remainingInBomBuffer.length - remainingInBytes.length : (stryCov_9fa48("3206"), remainingInBomBuffer.length + remainingInBytes.length));
              bufferToProcess.set(remainingInBomBuffer);
              bufferToProcess.set(remainingInBytes, remainingInBomBuffer.length);
            }
          } else {
            if (stryMutAct_9fa48("3207")) {
              {}
            } else {
              stryCov_9fa48("3207");
              // Not a BOM. Process the whole bomBuffer + remaining bytes.
              const remainingInBytes = stryMutAct_9fa48("3208") ? bytes : (stryCov_9fa48("3208"), bytes.slice(i));
              bufferToProcess = new Uint8Array(stryMutAct_9fa48("3209") ? this.bomBuffer.length - remainingInBytes.length : (stryCov_9fa48("3209"), this.bomBuffer.length + remainingInBytes.length));
              bufferToProcess.set(this.bomBuffer);
              bufferToProcess.set(remainingInBytes, this.bomBuffer.length);
            }
          }

          // Reset i and swap bytes to the reconstructed buffer
          i = 0;
          bytes = bufferToProcess;
        }
      }
      const startOffset = this.totalOffset;

      // If we have pending bytes from a previous chunk, try to complete the sequence
      if (stryMutAct_9fa48("3213") ? this.pending.length <= 0 : stryMutAct_9fa48("3212") ? this.pending.length >= 0 : stryMutAct_9fa48("3211") ? false : stryMutAct_9fa48("3210") ? true : (stryCov_9fa48("3210", "3211", "3212", "3213"), this.pending.length > 0)) {
        if (stryMutAct_9fa48("3214")) {
          {}
        } else {
          stryCov_9fa48("3214");
          while (stryMutAct_9fa48("3216") ? i < bytes.length || this.pending.length < this.pendingExpected : stryMutAct_9fa48("3215") ? false : (stryCov_9fa48("3215", "3216"), (stryMutAct_9fa48("3219") ? i >= bytes.length : stryMutAct_9fa48("3218") ? i <= bytes.length : stryMutAct_9fa48("3217") ? true : (stryCov_9fa48("3217", "3218", "3219"), i < bytes.length)) && (stryMutAct_9fa48("3222") ? this.pending.length >= this.pendingExpected : stryMutAct_9fa48("3221") ? this.pending.length <= this.pendingExpected : stryMutAct_9fa48("3220") ? true : (stryCov_9fa48("3220", "3221", "3222"), this.pending.length < this.pendingExpected)))) {
            if (stryMutAct_9fa48("3223")) {
              {}
            } else {
              stryCov_9fa48("3223");
              const b = bytes[i] as number;
              if (stryMutAct_9fa48("3226") ? (b & 0xc0) === 0x80 : stryMutAct_9fa48("3225") ? false : stryMutAct_9fa48("3224") ? true : (stryCov_9fa48("3224", "3225", "3226"), (b & 0xc0) !== 0x80)) {
                if (stryMutAct_9fa48("3227")) {
                  {}
                } else {
                  stryCov_9fa48("3227");
                  // Not a valid continuation byte — the pending sequence is broken
                  errors.push(stryMutAct_9fa48("3228") ? {} : (stryCov_9fa48("3228"), {
                    kind: stryMutAct_9fa48("3229") ? "" : (stryCov_9fa48("3229"), "invalid_continuation"),
                    byteOffset: stryMutAct_9fa48("3230") ? startOffset + this.pending.length : (stryCov_9fa48("3230"), startOffset - this.pending.length)
                  }));
                  this.pending = stryMutAct_9fa48("3231") ? ["Stryker was here"] : (stryCov_9fa48("3231"), []);
                  this.pendingExpected = 0;
                  // Don't consume this byte — it might be a valid start byte
                  break;
                }
              }
              this.pending.push(b);
              stryMutAct_9fa48("3232") ? i-- : (stryCov_9fa48("3232"), i++);
              stryMutAct_9fa48("3233") ? this.totalOffset-- : (stryCov_9fa48("3233"), this.totalOffset++);
            }
          }
          if (stryMutAct_9fa48("3236") ? this.pending.length !== this.pendingExpected : stryMutAct_9fa48("3235") ? false : stryMutAct_9fa48("3234") ? true : (stryCov_9fa48("3234", "3235", "3236"), this.pending.length === this.pendingExpected)) {
            if (stryMutAct_9fa48("3237")) {
              {}
            } else {
              stryCov_9fa48("3237");
              // We have a complete sequence — decode it
              const result = this.decodeSequence(this.pending, stryMutAct_9fa48("3238") ? startOffset + (this.pending.length - (i - 0)) : (stryCov_9fa48("3238"), startOffset - (stryMutAct_9fa48("3239") ? this.pending.length + (i - 0) : (stryCov_9fa48("3239"), this.pending.length - (stryMutAct_9fa48("3240") ? i + 0 : (stryCov_9fa48("3240"), i - 0))))));
              if (stryMutAct_9fa48("3242") ? false : stryMutAct_9fa48("3241") ? true : (stryCov_9fa48("3241", "3242"), result.error)) {
                if (stryMutAct_9fa48("3243")) {
                  {}
                } else {
                  stryCov_9fa48("3243");
                  errors.push(result.error);
                }
              } else {
                if (stryMutAct_9fa48("3244")) {
                  {}
                } else {
                  stryCov_9fa48("3244");
                  codePoints.push(result.codePoint);
                }
              }
              this.pending = stryMutAct_9fa48("3245") ? ["Stryker was here"] : (stryCov_9fa48("3245"), []);
              this.pendingExpected = 0;
            }
          } else if (stryMutAct_9fa48("3249") ? i < bytes.length : stryMutAct_9fa48("3248") ? i > bytes.length : stryMutAct_9fa48("3247") ? false : stryMutAct_9fa48("3246") ? true : (stryCov_9fa48("3246", "3247", "3248", "3249"), i >= bytes.length)) {
            if (stryMutAct_9fa48("3250")) {
              {}
            } else {
              stryCov_9fa48("3250");
              // Still incomplete — wait for more data
              const consumed = stryMutAct_9fa48("3251") ? this.totalOffset + startOffset : (stryCov_9fa48("3251"), this.totalOffset - startOffset);
              return stryMutAct_9fa48("3252") ? {} : (stryCov_9fa48("3252"), {
                text: stryMutAct_9fa48("3253") ? "Stryker was here!" : (stryCov_9fa48("3253"), ""),
                consumed,
                errors,
                strippedBom
              });
            }
          }
        }
      }

      // Process remaining bytes
      while (stryMutAct_9fa48("3256") ? i >= bytes.length : stryMutAct_9fa48("3255") ? i <= bytes.length : stryMutAct_9fa48("3254") ? false : (stryCov_9fa48("3254", "3255", "3256"), i < bytes.length)) {
        if (stryMutAct_9fa48("3257")) {
          {}
        } else {
          stryCov_9fa48("3257");
          const b = bytes[i] as number;
          const seqOffset = this.totalOffset;
          if (stryMutAct_9fa48("3261") ? b > 0x7f : stryMutAct_9fa48("3260") ? b < 0x7f : stryMutAct_9fa48("3259") ? false : stryMutAct_9fa48("3258") ? true : (stryCov_9fa48("3258", "3259", "3260", "3261"), b <= 0x7f)) {
            if (stryMutAct_9fa48("3262")) {
              {}
            } else {
              stryCov_9fa48("3262");
              // Single-byte ASCII
              codePoints.push(b);
              stryMutAct_9fa48("3263") ? i-- : (stryCov_9fa48("3263"), i++);
              stryMutAct_9fa48("3264") ? this.totalOffset-- : (stryCov_9fa48("3264"), this.totalOffset++);
            }
          } else if (stryMutAct_9fa48("3267") ? (b & 0xe0) !== 0xc0 : stryMutAct_9fa48("3266") ? false : stryMutAct_9fa48("3265") ? true : (stryCov_9fa48("3265", "3266", "3267"), (b & 0xe0) === 0xc0)) {
            if (stryMutAct_9fa48("3268")) {
              {}
            } else {
              stryCov_9fa48("3268");
              // 2-byte sequence
              const needed = 2;
              if (stryMutAct_9fa48("3272") ? i + needed > bytes.length : stryMutAct_9fa48("3271") ? i + needed < bytes.length : stryMutAct_9fa48("3270") ? false : stryMutAct_9fa48("3269") ? true : (stryCov_9fa48("3269", "3270", "3271", "3272"), (stryMutAct_9fa48("3273") ? i - needed : (stryCov_9fa48("3273"), i + needed)) <= bytes.length)) {
                if (stryMutAct_9fa48("3274")) {
                  {}
                } else {
                  stryCov_9fa48("3274");
                  const seq = stryMutAct_9fa48("3275") ? [] : (stryCov_9fa48("3275"), [b, bytes[i + 1] as number]);
                  const result = this.decodeSequence(seq, seqOffset);
                  if (stryMutAct_9fa48("3277") ? false : stryMutAct_9fa48("3276") ? true : (stryCov_9fa48("3276", "3277"), result.error)) {
                    if (stryMutAct_9fa48("3278")) {
                      {}
                    } else {
                      stryCov_9fa48("3278");
                      errors.push(result.error);
                      stryMutAct_9fa48("3279") ? i-- : (stryCov_9fa48("3279"), i++);
                      stryMutAct_9fa48("3280") ? this.totalOffset-- : (stryCov_9fa48("3280"), this.totalOffset++);
                    }
                  } else {
                    if (stryMutAct_9fa48("3281")) {
                      {}
                    } else {
                      stryCov_9fa48("3281");
                      codePoints.push(result.codePoint);
                      stryMutAct_9fa48("3282") ? i -= needed : (stryCov_9fa48("3282"), i += needed);
                      stryMutAct_9fa48("3283") ? this.totalOffset -= needed : (stryCov_9fa48("3283"), this.totalOffset += needed);
                    }
                  }
                }
              } else {
                if (stryMutAct_9fa48("3284")) {
                  {}
                } else {
                  stryCov_9fa48("3284");
                  // Incomplete at end of chunk — buffer it
                  this.pendingExpected = needed;
                  this.pending = stryMutAct_9fa48("3285") ? ["Stryker was here"] : (stryCov_9fa48("3285"), []);
                  for (let j = i; stryMutAct_9fa48("3288") ? j >= bytes.length : stryMutAct_9fa48("3287") ? j <= bytes.length : stryMutAct_9fa48("3286") ? false : (stryCov_9fa48("3286", "3287", "3288"), j < bytes.length); stryMutAct_9fa48("3289") ? j-- : (stryCov_9fa48("3289"), j++)) {
                    if (stryMutAct_9fa48("3290")) {
                      {}
                    } else {
                      stryCov_9fa48("3290");
                      this.pending.push(bytes[j] as number);
                    }
                  }
                  stryMutAct_9fa48("3291") ? this.totalOffset -= bytes.length - i : (stryCov_9fa48("3291"), this.totalOffset += stryMutAct_9fa48("3292") ? bytes.length + i : (stryCov_9fa48("3292"), bytes.length - i));
                  i = bytes.length;
                }
              }
            }
          } else if (stryMutAct_9fa48("3295") ? (b & 0xf0) !== 0xe0 : stryMutAct_9fa48("3294") ? false : stryMutAct_9fa48("3293") ? true : (stryCov_9fa48("3293", "3294", "3295"), (b & 0xf0) === 0xe0)) {
            if (stryMutAct_9fa48("3296")) {
              {}
            } else {
              stryCov_9fa48("3296");
              // 3-byte sequence
              const needed = 3;
              if (stryMutAct_9fa48("3300") ? i + needed > bytes.length : stryMutAct_9fa48("3299") ? i + needed < bytes.length : stryMutAct_9fa48("3298") ? false : stryMutAct_9fa48("3297") ? true : (stryCov_9fa48("3297", "3298", "3299", "3300"), (stryMutAct_9fa48("3301") ? i - needed : (stryCov_9fa48("3301"), i + needed)) <= bytes.length)) {
                if (stryMutAct_9fa48("3302")) {
                  {}
                } else {
                  stryCov_9fa48("3302");
                  const seq = stryMutAct_9fa48("3303") ? [] : (stryCov_9fa48("3303"), [b, bytes[i + 1] as number, bytes[i + 2] as number]);
                  const result = this.decodeSequence(seq, seqOffset);
                  if (stryMutAct_9fa48("3305") ? false : stryMutAct_9fa48("3304") ? true : (stryCov_9fa48("3304", "3305"), result.error)) {
                    if (stryMutAct_9fa48("3306")) {
                      {}
                    } else {
                      stryCov_9fa48("3306");
                      errors.push(result.error);
                      stryMutAct_9fa48("3307") ? i-- : (stryCov_9fa48("3307"), i++);
                      stryMutAct_9fa48("3308") ? this.totalOffset-- : (stryCov_9fa48("3308"), this.totalOffset++);
                    }
                  } else {
                    if (stryMutAct_9fa48("3309")) {
                      {}
                    } else {
                      stryCov_9fa48("3309");
                      codePoints.push(result.codePoint);
                      stryMutAct_9fa48("3310") ? i -= needed : (stryCov_9fa48("3310"), i += needed);
                      stryMutAct_9fa48("3311") ? this.totalOffset -= needed : (stryCov_9fa48("3311"), this.totalOffset += needed);
                    }
                  }
                }
              } else {
                if (stryMutAct_9fa48("3312")) {
                  {}
                } else {
                  stryCov_9fa48("3312");
                  this.pendingExpected = needed;
                  this.pending = stryMutAct_9fa48("3313") ? ["Stryker was here"] : (stryCov_9fa48("3313"), []);
                  for (let j = i; stryMutAct_9fa48("3316") ? j >= bytes.length : stryMutAct_9fa48("3315") ? j <= bytes.length : stryMutAct_9fa48("3314") ? false : (stryCov_9fa48("3314", "3315", "3316"), j < bytes.length); stryMutAct_9fa48("3317") ? j-- : (stryCov_9fa48("3317"), j++)) {
                    if (stryMutAct_9fa48("3318")) {
                      {}
                    } else {
                      stryCov_9fa48("3318");
                      this.pending.push(bytes[j] as number);
                    }
                  }
                  stryMutAct_9fa48("3319") ? this.totalOffset -= bytes.length - i : (stryCov_9fa48("3319"), this.totalOffset += stryMutAct_9fa48("3320") ? bytes.length + i : (stryCov_9fa48("3320"), bytes.length - i));
                  i = bytes.length;
                }
              }
            }
          } else if (stryMutAct_9fa48("3323") ? (b & 0xf8) !== 0xf0 : stryMutAct_9fa48("3322") ? false : stryMutAct_9fa48("3321") ? true : (stryCov_9fa48("3321", "3322", "3323"), (b & 0xf8) === 0xf0)) {
            if (stryMutAct_9fa48("3324")) {
              {}
            } else {
              stryCov_9fa48("3324");
              // 4-byte sequence
              const needed = 4;
              if (stryMutAct_9fa48("3328") ? i + needed > bytes.length : stryMutAct_9fa48("3327") ? i + needed < bytes.length : stryMutAct_9fa48("3326") ? false : stryMutAct_9fa48("3325") ? true : (stryCov_9fa48("3325", "3326", "3327", "3328"), (stryMutAct_9fa48("3329") ? i - needed : (stryCov_9fa48("3329"), i + needed)) <= bytes.length)) {
                if (stryMutAct_9fa48("3330")) {
                  {}
                } else {
                  stryCov_9fa48("3330");
                  const seq = stryMutAct_9fa48("3331") ? [] : (stryCov_9fa48("3331"), [b, bytes[i + 1] as number, bytes[i + 2] as number, bytes[i + 3] as number]);
                  const result = this.decodeSequence(seq, seqOffset);
                  if (stryMutAct_9fa48("3333") ? false : stryMutAct_9fa48("3332") ? true : (stryCov_9fa48("3332", "3333"), result.error)) {
                    if (stryMutAct_9fa48("3334")) {
                      {}
                    } else {
                      stryCov_9fa48("3334");
                      errors.push(result.error);
                      stryMutAct_9fa48("3335") ? i-- : (stryCov_9fa48("3335"), i++);
                      stryMutAct_9fa48("3336") ? this.totalOffset-- : (stryCov_9fa48("3336"), this.totalOffset++);
                    }
                  } else {
                    if (stryMutAct_9fa48("3337")) {
                      {}
                    } else {
                      stryCov_9fa48("3337");
                      codePoints.push(result.codePoint);
                      stryMutAct_9fa48("3338") ? i -= needed : (stryCov_9fa48("3338"), i += needed);
                      stryMutAct_9fa48("3339") ? this.totalOffset -= needed : (stryCov_9fa48("3339"), this.totalOffset += needed);
                    }
                  }
                }
              } else {
                if (stryMutAct_9fa48("3340")) {
                  {}
                } else {
                  stryCov_9fa48("3340");
                  this.pendingExpected = needed;
                  this.pending = stryMutAct_9fa48("3341") ? ["Stryker was here"] : (stryCov_9fa48("3341"), []);
                  for (let j = i; stryMutAct_9fa48("3344") ? j >= bytes.length : stryMutAct_9fa48("3343") ? j <= bytes.length : stryMutAct_9fa48("3342") ? false : (stryCov_9fa48("3342", "3343", "3344"), j < bytes.length); stryMutAct_9fa48("3345") ? j-- : (stryCov_9fa48("3345"), j++)) {
                    if (stryMutAct_9fa48("3346")) {
                      {}
                    } else {
                      stryCov_9fa48("3346");
                      this.pending.push(bytes[j] as number);
                    }
                  }
                  stryMutAct_9fa48("3347") ? this.totalOffset -= bytes.length - i : (stryCov_9fa48("3347"), this.totalOffset += stryMutAct_9fa48("3348") ? bytes.length + i : (stryCov_9fa48("3348"), bytes.length - i));
                  i = bytes.length;
                }
              }
            }
          } else {
            if (stryMutAct_9fa48("3349")) {
              {}
            } else {
              stryCov_9fa48("3349");
              // Invalid start byte (0x80-0xBF or 0xF8+)
              errors.push(stryMutAct_9fa48("3350") ? {} : (stryCov_9fa48("3350"), {
                kind: stryMutAct_9fa48("3351") ? "" : (stryCov_9fa48("3351"), "invalid_start_byte"),
                byteOffset: seqOffset
              }));
              stryMutAct_9fa48("3352") ? i-- : (stryCov_9fa48("3352"), i++);
              stryMutAct_9fa48("3353") ? this.totalOffset-- : (stryCov_9fa48("3353"), this.totalOffset++);
            }
          }
        }
      }
      const text = String.fromCodePoint(...codePoints);
      const consumed = stryMutAct_9fa48("3354") ? this.totalOffset + startOffset : (stryCov_9fa48("3354"), this.totalOffset - startOffset);
      return stryMutAct_9fa48("3355") ? {} : (stryCov_9fa48("3355"), {
        text,
        consumed,
        errors,
        strippedBom
      });
    }
  }

  /**
   * Check if there are buffered incomplete bytes.
   */
  hasIncomplete(): boolean {
    if (stryMutAct_9fa48("3356")) {
      {}
    } else {
      stryCov_9fa48("3356");
      return stryMutAct_9fa48("3360") ? this.pending.length <= 0 : stryMutAct_9fa48("3359") ? this.pending.length >= 0 : stryMutAct_9fa48("3358") ? false : stryMutAct_9fa48("3357") ? true : (stryCov_9fa48("3357", "3358", "3359", "3360"), this.pending.length > 0);
    }
  }

  /**
   * Get the byte offset where the incomplete sequence started.
   */
  incompleteByteOffset(): number {
    if (stryMutAct_9fa48("3361")) {
      {}
    } else {
      stryCov_9fa48("3361");
      return stryMutAct_9fa48("3362") ? this.totalOffset + this.pending.length : (stryCov_9fa48("3362"), this.totalOffset - this.pending.length);
    }
  }

  /**
   * Reset decoder state.
   */
  reset(): void {
    if (stryMutAct_9fa48("3363")) {
      {}
    } else {
      stryCov_9fa48("3363");
      this.pending = stryMutAct_9fa48("3364") ? ["Stryker was here"] : (stryCov_9fa48("3364"), []);
      this.pendingExpected = 0;
      this.totalOffset = 0;
    }
  }

  /**
   * Total bytes processed (including any pending).
   */
  get totalBytesProcessed(): number {
    if (stryMutAct_9fa48("3365")) {
      {}
    } else {
      stryCov_9fa48("3365");
      return this.totalOffset;
    }
  }

  /**
   * Decode a complete multi-byte UTF-8 sequence into a code point.
   * Returns an error for invalid continuation, overlong, or out-of-range sequences.
   */
  private decodeSequence(seq: number[], offset: number): {
    codePoint: number;
    error?: undefined;
  } | {
    codePoint: number;
    error: Utf8Error;
  } {
    if (stryMutAct_9fa48("3366")) {
      {}
    } else {
      stryCov_9fa48("3366");
      const len = seq.length;

      // Validate continuation bytes
      for (let i = 1; stryMutAct_9fa48("3369") ? i >= len : stryMutAct_9fa48("3368") ? i <= len : stryMutAct_9fa48("3367") ? false : (stryCov_9fa48("3367", "3368", "3369"), i < len); stryMutAct_9fa48("3370") ? i-- : (stryCov_9fa48("3370"), i++)) {
        if (stryMutAct_9fa48("3371")) {
          {}
        } else {
          stryCov_9fa48("3371");
          if (stryMutAct_9fa48("3374") ? ((seq[i] as number) & 0xc0) === 0x80 : stryMutAct_9fa48("3373") ? false : stryMutAct_9fa48("3372") ? true : (stryCov_9fa48("3372", "3373", "3374"), ((seq[i] as number) & 0xc0) !== 0x80)) {
            if (stryMutAct_9fa48("3375")) {
              {}
            } else {
              stryCov_9fa48("3375");
              return stryMutAct_9fa48("3376") ? {} : (stryCov_9fa48("3376"), {
                codePoint: 0,
                error: stryMutAct_9fa48("3377") ? {} : (stryCov_9fa48("3377"), {
                  kind: stryMutAct_9fa48("3378") ? "" : (stryCov_9fa48("3378"), "invalid_continuation"),
                  byteOffset: offset
                })
              });
            }
          }
        }
      }
      let codePoint: number;
      let minCodePoint: number;
      if (stryMutAct_9fa48("3381") ? len !== 2 : stryMutAct_9fa48("3380") ? false : stryMutAct_9fa48("3379") ? true : (stryCov_9fa48("3379", "3380", "3381"), len === 2)) {
        if (stryMutAct_9fa48("3382")) {
          {}
        } else {
          stryCov_9fa48("3382");
          codePoint = ((seq[0] as number) & 0x1f) << 6 | (seq[1] as number) & 0x3f;
          minCodePoint = 0x80;
        }
      } else if (stryMutAct_9fa48("3385") ? len !== 3 : stryMutAct_9fa48("3384") ? false : stryMutAct_9fa48("3383") ? true : (stryCov_9fa48("3383", "3384", "3385"), len === 3)) {
        if (stryMutAct_9fa48("3386")) {
          {}
        } else {
          stryCov_9fa48("3386");
          codePoint = ((seq[0] as number) & 0x0f) << 12 | ((seq[1] as number) & 0x3f) << 6 | (seq[2] as number) & 0x3f;
          minCodePoint = 0x800;
        }
      } else {
        if (stryMutAct_9fa48("3387")) {
          {}
        } else {
          stryCov_9fa48("3387");
          // len === 4
          codePoint = ((seq[0] as number) & 0x07) << 18 | ((seq[1] as number) & 0x3f) << 12 | ((seq[2] as number) & 0x3f) << 6 | (seq[3] as number) & 0x3f;
          minCodePoint = 0x10000;
        }
      }

      // Check overlong encoding
      if (stryMutAct_9fa48("3391") ? codePoint >= minCodePoint : stryMutAct_9fa48("3390") ? codePoint <= minCodePoint : stryMutAct_9fa48("3389") ? false : stryMutAct_9fa48("3388") ? true : (stryCov_9fa48("3388", "3389", "3390", "3391"), codePoint < minCodePoint)) {
        if (stryMutAct_9fa48("3392")) {
          {}
        } else {
          stryCov_9fa48("3392");
          return stryMutAct_9fa48("3393") ? {} : (stryCov_9fa48("3393"), {
            codePoint: 0,
            error: stryMutAct_9fa48("3394") ? {} : (stryCov_9fa48("3394"), {
              kind: stryMutAct_9fa48("3395") ? "" : (stryCov_9fa48("3395"), "overlong"),
              byteOffset: offset
            })
          });
        }
      }

      // Check valid Unicode range
      if (stryMutAct_9fa48("3399") ? codePoint <= 0x10ffff : stryMutAct_9fa48("3398") ? codePoint >= 0x10ffff : stryMutAct_9fa48("3397") ? false : stryMutAct_9fa48("3396") ? true : (stryCov_9fa48("3396", "3397", "3398", "3399"), codePoint > 0x10ffff)) {
        if (stryMutAct_9fa48("3400")) {
          {}
        } else {
          stryCov_9fa48("3400");
          return stryMutAct_9fa48("3401") ? {} : (stryCov_9fa48("3401"), {
            codePoint: 0,
            error: stryMutAct_9fa48("3402") ? {} : (stryCov_9fa48("3402"), {
              kind: stryMutAct_9fa48("3403") ? "" : (stryCov_9fa48("3403"), "out_of_range"),
              byteOffset: offset
            })
          });
        }
      }
      return stryMutAct_9fa48("3404") ? {} : (stryCov_9fa48("3404"), {
        codePoint
      });
    }
  }
}

/**
 * Convert a string to its UTF-8 byte representation.
 * Utility for tests and string-mode push().
 */
export function stringToUtf8(str: string): Uint8Array {
  if (stryMutAct_9fa48("3405")) {
    {}
  } else {
    stryCov_9fa48("3405");
    const encoder = new TextEncoder();
    return encoder.encode(str);
  }
}