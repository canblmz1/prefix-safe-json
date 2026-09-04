import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import {
  PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

// Gemini function call shape (structured)
interface GeminiFunctionCall {
  name?: string;
  args?: unknown; // Gemini returns a structured value, not raw JSON argument evidence.
}

interface GeminiPart {
  functionCall?: GeminiFunctionCall;
  // If in future they support streaming raw JSON text, we'd handle it here
  // For now, this is structured.
}

interface GeminiContent {
  parts?: GeminiPart[];
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
  // Phase B.2 identity correction: the official wire field. Confirmed
  // directly against the installed `@google/genai@2.21.0` SDK's own
  // `Candidate` type declaration ("Output only. The 0-based index of this
  // candidate in the list of generated responses. This is useful for
  // distinguishing between multiple candidates when `candidate_count` > 1")
  // and empirically against its real SSE parser (see
  // test/integration/gemini-official-sdk-lifecycle.test.ts) - NOT array
  // position. The prior implementation's premise (no such field exists)
  // was wrong; array position was never a safe proxy for candidate
  // identity across separate chunks (a candidate omitted from one chunk,
  // or candidates reordered within one chunk, silently changes every
  // later candidate's own positional "identity").
  index?: number;
}

export interface GeminiEvent {
  candidates?: GeminiCandidate[];
}

// Reason priority for aggregating candidate-local terminal reasons into the
// ONE stream-wide reason, at adapter.finish() time. Same values/order/
// "worst wins" semantics as every other adapter's own REASON_PRIORITY in
// this codebase (see openai-compatible.ts's own doc comment for the full
// rationale) - duplicated locally rather than cross-imported, matching this
// project's established convention for self-contained provider files.
const REASON_PRIORITY: readonly StreamEndReason[] = [
  "provider_error",
  "unknown",
  "network_error",
  "length",
  "cancelled",
  "complete",
];

// Phase B.7: re-checked against the installed @google/genai@2.21.0 SDK's
// own `FinishReason` enum, which is considerably larger than the four
// values previously handled: FINISH_REASON_UNSPECIFIED, STOP, MAX_TOKENS,
// SAFETY, RECITATION, LANGUAGE, OTHER, BLOCKLIST, PROHIBITED_CONTENT,
// SPII, MALFORMED_FUNCTION_CALL, IMAGE_SAFETY, UNEXPECTED_TOOL_CALL,
// TOO_MANY_TOOL_CALLS, IMAGE_PROHIBITED_CONTENT, NO_IMAGE,
// IMAGE_RECITATION, IMAGE_OTHER. Every value not explicitly recognized
// below - including every one of those newer/rarer values - intentionally
// falls through to "unknown", not "complete": unknown is non-executable
// (parser.ts's isExecutable() requires reason === "complete" exactly), so
// this is a safe, deliberate default, not a gap - see the regression
// coverage proving MALFORMED_FUNCTION_CALL/UNEXPECTED_TOOL_CALL/
// PROHIBITED_CONTENT/BLOCKLIST specifically cannot aggregate to "complete".
function mapFinishReason(finishReason: string): StreamEndReason {
  if (finishReason === "STOP") return "complete";
  if (finishReason === "MAX_TOKENS") return "length";
  if (finishReason === "SAFETY" || finishReason === "RECITATION" || finishReason === "OTHER") return "cancelled";
  return "unknown";
}

/**
 * Gemini `generateContentStream`-shaped streaming adapter.
 *
 * Terminal-ownership fix (Phase B hardening sweep, corrected in Phase B.1-
 * B.7 after an identity-premise error was found in raw review):
 * `candidate.finishReason` is candidate-LOCAL evidence only - a genuine
 * multi-candidate (n>1) stream has one finishReason per candidate, each
 * reporting only that candidate's own completion, never the whole provider
 * stream's. Pre-fix, ANY candidate's finishReason directly emitted
 * `provider_stream_end` and set this adapter's own global `finished` flag -
 * the same "first choice to finish wrongly ends every choice" defect
 * already found and fixed for OpenAI (Chat Completions plural and legacy
 * singular) and Anthropic this session.
 *
 * Candidate IDENTITY correction (Phase B.1/B.2, the raw-review finding):
 * this adapter used to key all candidate-local state by array POSITION
 * within each chunk's own `candidates` list. The real wire field
 * `candidate.index` ("Output only. The 0-based index of this candidate...
 * useful for distinguishing between multiple candidates when
 * candidate_count > 1" - confirmed against the installed
 * `@google/genai@2.21.0` SDK's own types AND its real SSE parser, see
 * test/integration/gemini-official-sdk-lifecycle.test.ts) is the
 * authoritative identity instead. Array position silently breaks the
 * moment a chunk omits an already-finished candidate (entirely normal - a
 * provider has no reason to keep re-sending a candidate with nothing new
 * to say) or reorders candidates within one chunk: real candidate 1's
 * evidence arriving alone, at array position 0, was silently misattributed
 * to candidate 0's own (already-terminal) identity - captured as genuine
 * RED against real SDK-parsed chunks before this fix, not merely inferred.
 *
 * Fixed the same way as OpenAI's legacy path (P4.3) and Anthropic (P4.2):
 *   candidate.finishReason
 *     -> records that candidate's own terminal StreamEndReason
 *     -> does NOT emit provider_stream_end
 *     -> does NOT set this adapter's global `finished` flag
 *   finish(meta?)
 *     -> the ONE provider_stream_end for this adapter's whole lifetime,
 *        aggregating every recorded candidate-local reason (worst wins -
 *        see REASON_PRIORITY above) with meta.reason.
 *
 * Post-provider-terminal handling (Phase B.6): the top-of-push()
 * `if (this.finished) return [];` guard, previously the only adapter in
 * this codebase deliberately retaining the pre-P0 silent-drop pattern, is
 * REMOVED here too - normalization continues after adapter.finish(), and
 * coordinator.ts's own `isFinished` gate provides the canonical
 * post-provider-terminal handling, exactly like every other adapter. This
 * is future-proofing / architectural consistency, NOT the closing of a
 * demonstrated execution-authority gap: independently re-verified, not
 * merely trusted, that no Gemini call can ever reach `execute` -
 * PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE is unconditional on every
 * functionCall and checked by decide.ts before status is even considered;
 * gate.ts's takeDecision() re-derives fresh and only ever returns
 * something for action==="execute". See the two-part epistemic
 * distinction in this program's own final report: CORRECTNESS/
 * architecture-consistency, never claimed as an execution-integrity fix.
 */
export class GeminiStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "gemini";
  private sequence = 0;
  private finished = false;

  // candidateIndex (the real wire `candidate.index`, never array position)
  // -> that candidate's own first-recorded terminal StreamEndReason. Never
  // overwritten once set for a given candidate - a second/conflicting
  // finishReason for the same candidate is reported as candidate-local
  // post-terminal evidence (see push()), not silently applied over the
  // first. Read by finish() to aggregate one stream-wide reason.
  private candidateTerminalReasons: Map<number, StreamEndReason> = new Map();
  // The same candidates' own RAW (pre-normalization) finishReason strings,
  // keyed identically - observability only, mirrored onto the aggregated
  // provider_stream_end's own providerReason.
  private candidateTerminalProviderReasons: Map<number, string> = new Map();
  // Phase B.5: every sourceKey EVER started under a real candidate index,
  // never cleared. Read only when late/duplicate evidence arrives for an
  // already-terminal candidate, so the disqualifying diagnostic can be
  // attributed to every REAL, already-tracked call under that candidate
  // (exact attribution) rather than a synthetic, never-resolvable
  // "candidate:{i}" identity alone - mirrors
  // OpenAICompatibleStreamAdapter's own allSourceKeysByChoice exactly, for
  // the identical reason (a brand-new call is never created under an
  // already-terminal candidate, so a diagnostic attached only to ITS OWN
  // sourceKey could sit forever unresolved and disqualify nothing real).
  private candidateSourceKeys: Map<number, Set<string>> = new Map();

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    // No `finished` early return here (Phase B.6) - see the identical fix
    // and rationale in every other adapter's push()
    // (GHSA-3xpw-9694-2xxp-class invariant). Gemini has no live execution
    // authority for this to protect today (see the class-level doc comment
    // above), but the coordinator's own isFinished gate is still the
    // canonical place post-provider-terminal handling belongs, not a
    // second, adapter-local silent-drop mechanism.
    const events: NormalizedToolStreamEvent[] = [];

    if (!rawEvent || typeof rawEvent !== "object") {
      events.push({
        type: "provider_diagnostic",
        sequence: ++this.sequence,
        provider: this.provider,
        code: "E_PROVIDER_EVENT_MALFORMED",
        severity: "error",
        message: "Raw event is not an object",
      });
      return events;
    }

    const chunk = rawEvent as GeminiEvent;

    if (Array.isArray(chunk.candidates)) {
      // Duplicate-index detection within one chunk - mirrors
      // OpenAICompatibleStreamAdapter's/OpenAIStreamAdapter's own
      // choiceCounts pre-pass exactly (Phase B.3).
      const candidateCounts = new Map<number, number>();
      for (const candidate of chunk.candidates) {
        if (Number.isInteger(candidate.index) && (candidate.index as number) >= 0) {
          candidateCounts.set(candidate.index as number, (candidateCounts.get(candidate.index as number) ?? 0) + 1);
        }
      }

      for (const candidate of chunk.candidates) {
        // Choice-index validity (Phase B.3): a candidate with no
        // trustworthy explicit index must never be silently assumed to be
        // candidate 0 via array position - global, unattributable, fails
        // the whole stream closed rather than guessing (same fail-closed
        // posture INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE already has for the
        // OpenAI paths - reused rather than inventing a new code, since
        // the identity ambiguity it represents is identical here). A
        // finishReason-only candidate (no functionCall evidence at all)
        // with an invalid index carries no tracked identity to protect
        // and is simply skipped, not diagnosed - matches the identical,
        // already-established design for OpenAI's legacy path.
        const hasFunctionCall = !!(candidate.content && Array.isArray(candidate.content.parts) && candidate.content.parts.some((p) => p.functionCall));
        if (!Number.isInteger(candidate.index) || (candidate.index as number) < 0) {
          if (hasFunctionCall) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: "Gemini candidate.index is missing, non-integer, or negative; candidate identity is ambiguous",
            });
          }
          continue;
        }
        const candidateIndex = candidate.index as number;

        if ((candidateCounts.get(candidateIndex) ?? 0) > 1) {
          if (hasFunctionCall) {
            // Phase B.5's own "exact attribution when real calls exist"
            // principle applied consistently here too: a candidate-level
            // synthetic "candidate:{i}" identity can never resolve to a
            // real "candidate:{i}/part:{j}" sourceKey (this candidate may
            // have multiple real parts, unlike OpenAI's legacy path,
            // which has exactly one call per choice so the two happen to
            // coincide there) - if this candidate already has real,
            // already-tracked calls from earlier, legitimate evidence,
            // attribute to every one of them so the violation actually
            // disqualifies something real, not a permanently-unresolvable
            // pending diagnostic.
            const known = this.candidateSourceKeys.get(candidateIndex);
            if (known && known.size > 0) {
              for (const knownSourceKey of known) {
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey: knownSourceKey },
                  code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
                  severity: "error",
                  message: `candidate.index ${candidateIndex} is duplicated in one provider event; call ${knownSourceKey} is disqualified`,
                });
              }
            } else {
              events.push({
                type: "provider_diagnostic",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey: `candidate:${candidateIndex}` },
                code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
                severity: "error",
                message: `candidate.index ${candidateIndex} is duplicated in one provider event`,
              });
            }
          }
          continue;
        }

        const candidateAlreadyTerminal = this.candidateTerminalReasons.has(candidateIndex);

        if (candidate.content && Array.isArray(candidate.content.parts)) {
          for (const [partIndex, part] of candidate.content.parts.entries()) {
            if (part.functionCall) {
              const fc = part.functionCall;
              const sourceKey = `candidate:${candidateIndex}/part:${partIndex}`;

              if (candidateAlreadyTerminal) {
                // Phase B.5: exact attribution. Each Gemini part is
                // object-level final delivery (never incrementally
                // streamed - see the class doc), so there is no
                // in-progress call of this candidate's own to disqualify
                // via THIS specific sourceKey - but if this candidate
                // already has other REAL, tracked calls (earlier parts),
                // late evidence disqualifies every one of them, not just
                // a forensic record against its own never-resolvable
                // identity - mirrors OpenAICompatibleStreamAdapter's own
                // choiceAlreadyTerminal branch exactly.
                const known = this.candidateSourceKeys.get(candidateIndex);
                if (known && known.size > 0) {
                  for (const knownSourceKey of known) {
                    events.push({
                      type: "provider_diagnostic",
                      sequence: ++this.sequence,
                      provider: this.provider,
                      callRef: { sourceKey: knownSourceKey },
                      code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
                      severity: "error",
                      message: `Tool call evidence for candidate ${candidateIndex} arrived after that candidate's own finishReason; call ${knownSourceKey} is disqualified`,
                    });
                  }
                } else {
                  // No call was ever tracked for this candidate at all -
                  // nothing exists yet to disqualify, but the attempt
                  // itself is still worth a forensic record against its
                  // own (never-resolvable) sourceKey.
                  events.push({
                    type: "provider_diagnostic",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
                    severity: "error",
                    message: `Tool call evidence for candidate ${candidateIndex} arrived after that candidate's own finishReason`,
                  });
                }
                continue;
              }

              let known = this.candidateSourceKeys.get(candidateIndex);
              if (!known) {
                known = new Set();
                this.candidateSourceKeys.set(candidateIndex, known);
              }
              known.add(sourceKey);

              events.push({
                type: "tool_call_start",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                name: fc.name,
              });

              events.push({
                type: "provider_diagnostic",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                code: PROJECTION_ONLY_ARGUMENTS_DIAGNOSTIC_CODE,
                severity: "warning",
                message: "Gemini function-call arguments are a structured projection, not raw streamed argument evidence",
              });

              if (fc.args !== undefined) {
                // Gemini currently emits structured objects.
                // We serialize it to emulate a text delta, BUT it is documented in docs/providers/gemini.md
                // that this is NOT byte-level streaming. It is object-level final delivery.
                try {
                  const projected = JSON.stringify(fc.args);
                  if (projected === undefined) {
                    throw new TypeError("structured arguments are not JSON-serializable");
                  }
                  events.push({
                    type: "tool_call_arguments_delta",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    delta: projected,
                  });
                } catch {
                  events.push({
                    type: "provider_diagnostic",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    code: "E_GEMINI_ARGUMENT_PROJECTION_FAILED",
                    severity: "error",
                    message: "Gemini structured function-call arguments could not be projected to JSON",
                  });
                }
              }

              events.push({
                type: "tool_call_end",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                reason: "complete",
              });
            }
          }
        }

        if (candidate.finishReason) {
          if (candidateAlreadyTerminal) {
            // Duplicate/conflicting terminal for the SAME candidate
            // (Phase B.5): never silently overwrite the first-recorded
            // reason. Exact attribution, same as the late-functionCall
            // case above: every REAL, already-tracked call under this
            // candidate is disqualified, not merely a synthetic
            // "candidate:{i}" identity that was never a real call.
            const known = this.candidateSourceKeys.get(candidateIndex);
            if (known && known.size > 0) {
              for (const knownSourceKey of known) {
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey: knownSourceKey },
                  code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
                  severity: "error",
                  message: `candidate ${candidateIndex} received a second finishReason ("${candidate.finishReason}") after already terminating; call ${knownSourceKey} is disqualified`,
                });
              }
            } else {
              // No tool call ever existed under this candidate - the
              // diagnostic is recorded for forensic visibility only and
              // disqualifies nothing, because there is nothing to
              // disqualify.
              events.push({
                type: "provider_diagnostic",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey: `candidate:${candidateIndex}` },
                code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
                severity: "error",
                message: `candidate ${candidateIndex} received a second finishReason ("${candidate.finishReason}") after already terminating`,
              });
            }
          } else {
            const reason = mapFinishReason(candidate.finishReason);
            this.candidateTerminalReasons.set(candidateIndex, reason);
            this.candidateTerminalProviderReasons.set(candidateIndex, candidate.finishReason);
            // No provider_stream_end here, and `this.finished` stays
            // false: this candidate finishing is not, by itself, proof
            // the whole provider stream (which may still have other
            // candidates actively generating) has ended. See finish().
          }
        }
      }
    }

    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const { reason, providerReason } = this.aggregateTermination(meta?.reason, meta?.providerReason);
    return [{
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason,
      providerReason,
    }];
  }

  // One stream-wide StreamEndReason from every candidate-local reason
  // recorded so far, plus any caller-supplied override - "complete" only
  // if every single one of them was "complete". Mirrors every other
  // adapter's own aggregateTermination()/aggregateLegacyTermination()
  // exactly (see REASON_PRIORITY above for why it is duplicated locally
  // rather than cross-imported).
  private aggregateTermination(
    callerReason?: StreamEndReason,
    callerProviderReason?: string,
  ): { reason: StreamEndReason; providerReason?: string } {
    let worst: StreamEndReason | undefined;
    let worstRank = Infinity;
    let worstProviderReason: string | undefined;

    for (const [candidateIndex, candidate] of this.candidateTerminalReasons.entries()) {
      const rank = REASON_PRIORITY.indexOf(candidate);
      if (rank !== -1 && rank < worstRank) {
        worst = candidate;
        worstRank = rank;
        worstProviderReason = this.candidateTerminalProviderReasons.get(candidateIndex);
      }
    }

    if (callerReason !== undefined) {
      const rank = REASON_PRIORITY.indexOf(callerReason);
      if (rank !== -1 && rank < worstRank) {
        worst = callerReason;
        worstRank = rank;
        worstProviderReason = callerProviderReason;
      }
    }

    if (worst === undefined) return { reason: "unknown", providerReason: callerProviderReason };
    return { reason: worst, providerReason: worstProviderReason };
  }
}
