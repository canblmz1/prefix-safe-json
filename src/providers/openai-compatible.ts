import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import {
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

interface OpenAIChoiceDelta {
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: {
      name?: string;
      arguments?: string;
    };
  }>;
}

interface OpenAIChoice {
  index?: number;
  delta?: OpenAIChoiceDelta;
  finish_reason?: string | null;
}

export interface OpenAICompatibleEvent {
  choices?: OpenAIChoice[];
}

// Reason values a choice's own finish_reason can map to, ordered most- to
// least-restrictive. Used by finish()'s reason aggregation: whichever
// recorded choice reason (plus any caller-supplied `meta.reason`) ranks
// EARLIEST here wins as the one stream-wide reason - "complete" only when
// every recorded reason was itself "complete", so a mix like
// ["complete", "length"] can never launder into an overall "complete".
// Directly evidenced for `provider_error`'s own top rank: decide.ts checks
// `ctx.streamEndReason === "provider_error"` explicitly, before any
// per-call status branching, unconditionally rejecting every call - the
// single strongest, most stream-wide-authoritative reason in the existing
// gate. The remaining relative order (unknown > network_error > length >
// cancelled > complete) is this adapter's own conservative extension of
// that same fail-closed philosophy: any reason other than "complete" means
// at least one choice did not finish normally, so it must dominate.
const REASON_PRIORITY: readonly StreamEndReason[] = [
  "provider_error",
  "unknown",
  "network_error",
  "length",
  "cancelled",
  "complete",
];

function mapFinishReason(providerReason: string): StreamEndReason {
  if (providerReason === "stop" || providerReason === "tool_calls") return "complete";
  if (providerReason === "length") return "length";
  if (providerReason === "cancelled") return "cancelled";
  return "unknown";
}

/**
 * Chat-Completions-shaped ("OpenAI-compatible") streaming adapter.
 *
 * Lifecycle contract (`@public (Experimental)` - see docs/COMPATIBILITY.md;
 * this is a deliberate, disclosed lifecycle correction, not an accidental
 * behavior change):
 *
 *   choice.finish_reason
 *     -> closes ONLY the tool calls belonging to that exact choice index
 *        (tool_call_end per open call)
 *     -> records that choice's own terminal StreamEndReason
 *     -> does NOT emit provider_stream_end
 *     -> does NOT set this adapter's global `finished` state
 *
 *   finish(meta?)
 *     -> the ONE provider_stream_end for this adapter's whole lifetime,
 *        closing any call whose own choice never reported a finish_reason
 *        at all, with a reason aggregated from every choice-local reason
 *        recorded so far plus `meta.reason` (see REASON_PRIORITY above) -
 *        call this once the caller has drained the raw provider iterator.
 *
 * Why: a single choice's finish_reason is call-local evidence only. For an
 * ordinary single-choice (the overwhelmingly common, n=1) stream this was
 * previously indistinguishable from the whole provider stream ending, so
 * treating it as such was harmless. For a genuine multi-choice (n>1)
 * stream it is not: this adapter has no visibility into the request's own
 * `n`, and no wire-level signal available to `push()` proves no further,
 * unseen choice can still appear - only the caller's own raw-iterator
 * exhaustion (driving an explicit `finish()` call) can. Previously, the
 * first choice to finish was wrongly treated as ending the entire stream:
 * every OTHER choice's still-tracked calls were force-closed by a single,
 * shared `knownSourceKeys` Set and the stream was declared over via a real
 * `provider_stream_end` - which could make a call belonging to a
 * completely different, still-generating choice genuinely, immediately
 * executable (a real, empirically-confirmed `takeDecision()`-able
 * authority window) purely because an unrelated choice finished first, and
 * separately made a second finishing choice's own, entirely real
 * termination look like corrupt/duplicate post-terminal evidence,
 * poisoning every call in the stream via the coordinator's own
 * EVENT_AFTER_STREAM_END/TERMINAL_REASON_CONFLICT protocol.
 */
export class OpenAICompatibleStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openai-compatible";
  private sequence = 0;

  // Track full provider coordinates, never the tool index alone.
  private startedSourceKeys: Set<string> = new Set();
  // Choice-scoped: which sourceKeys are currently open (started, not yet
  // closed by their OWN choice's finish_reason) under each choice index.
  // Replaces a single, adapter-wide Set - a choice's finish_reason must
  // close exactly its own entries here, never another choice's.
  private openSourceKeysByChoice: Map<number, Set<string>> = new Map();
  // Every choice index that has reported its own finish_reason, and the
  // StreamEndReason it mapped to. Never overwritten once set for a given
  // choice - a second/conflicting finish_reason for the same choice is
  // reported as choice-local post-terminal evidence (see push()), not
  // silently applied over the first. Read by finish() to aggregate one
  // stream-wide reason.
  private choiceTerminalReasons: Map<number, StreamEndReason> = new Map();
  // The same choices' own RAW (pre-normalization) finish_reason strings,
  // keyed identically. Kept separate from choiceTerminalReasons rather than
  // folded into it because this is pure observability data (mirrored onto
  // DecisionEvidence.providerReason - see decide.ts's own doc comment:
  // "never consulted by the decision logic itself"), whereas
  // choiceTerminalReasons drives real aggregation logic. Read by finish()
  // alongside it so the one stream-wide provider_stream_end can carry the
  // specific raw string that produced its aggregated reason instead of
  // silently dropping it.
  private choiceTerminalProviderReasons: Map<number, string> = new Map();
  // Every sourceKey EVER started under a choice index, never cleared (unlike
  // openSourceKeysByChoice, which drops entries the moment their choice
  // closes them). Read only when late tool-call evidence arrives for an
  // already-terminal choice (see push()'s choiceAlreadyTerminal branch): a
  // brand-new tool index injected under a finished choice never gets a
  // coordinator call created for it at all, so a diagnostic attached only
  // to ITS OWN (never-resolvable) sourceKey can never disqualify anything -
  // this lets the adapter instead attach the disqualifying diagnostic to
  // every REAL, already-started call the choice actually has, without
  // parsing choice ownership back out of a sourceKey string.
  private allSourceKeysByChoice: Map<number, Set<string>> = new Map();
  // Sticky, never reset: set the moment ANY choice reports a second (or
  // conflicting) finish_reason after already recording one. A well-behaved
  // provider never does this at all - once observed, this stream's
  // protocol can no longer be trusted, so finish()'s aggregated reason is
  // unconditionally forced to "provider_error" (see aggregateTermination())
  // regardless of what any individual choice or the caller's own
  // meta.reason claims. Deliberately NOT scoped to the one violating choice
  // - see BLOCKER 2 in this file's own review history for why a stream-wide
  // fail-closed guarantee, not a per-choice diagnostic, is the correct fix
  // for a duplicated/conflicting CHOICE-level terminal specifically.
  private choiceTerminalProtocolViolation = false;

  private finished = false;

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    if (this.finished) {
      return [{
        type: "provider_diagnostic",
        sequence: ++this.sequence,
        provider: this.provider,
        code: "W_EVENT_AFTER_STREAM_END",
        severity: "warning",
        message: "Received event after stream finished",
      }];
    }

    const events: NormalizedToolStreamEvent[] = [];

    // Narrow unknown
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

    const chunk = rawEvent as OpenAICompatibleEvent;

    if (Array.isArray(chunk.choices)) {
      const choiceCounts = new Map<number, number>();
      for (const choice of chunk.choices) {
        if (Number.isInteger(choice.index) && (choice.index as number) >= 0) {
          const choiceIndex = choice.index as number;
          choiceCounts.set(choiceIndex, (choiceCounts.get(choiceIndex) ?? 0) + 1);
        }
      }

      for (const choice of chunk.choices) {
        if (!Number.isInteger(choice.index) || (choice.index as number) < 0) {
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            code: INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
            severity: "error",
            message: "choice.index is missing, non-integer, or negative; tool-call identity is ambiguous",
          });
          continue;
        }
        const choiceIndex = choice.index as number;
        if ((choiceCounts.get(choiceIndex) ?? 0) > 1) {
          const toolCalls = choice.delta?.tool_calls ?? [];
          if (toolCalls.length === 0) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice.index ${choiceIndex} is duplicated in one provider event`,
            });
          }
          for (const tc of toolCalls) {
            const hasToolIndex = Number.isInteger(tc.index) && tc.index >= 0;
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice.index ${choiceIndex} is duplicated in one provider event`,
              ...(hasToolIndex
                ? { callRef: { sourceKey: `choice:${choiceIndex}/tool-index:${tc.index}` } }
                : {}),
            });
          }
          continue;
        }

        // Choice-local post-terminal evidence: this exact choice already
        // recorded its own finish_reason. Never merge further tool-call
        // evidence for it as normal (would either silently mutate an
        // already-closed call's value with no record of the anomaly, or
        // let a brand-new tool call start and become tracked/executable
        // under a choice the provider itself already said was done) -
        // raise the same authority-disqualifying diagnostic
        // AiSdkStreamAdapter already uses for materially identical
        // semantics ("argument evidence arrived after the call's end
        // part"), attributed to the specific sourceKey when there is
        // one, so the coordinator resolves it to a real call
        // (handleProviderDiagnostic) or holds it pending
        // (pendingProtocolDiagnostics) for a sourceKey that never
        // actually gets a tool_call_start at all - which is exactly the
        // point: a brand-new call is never created under a finished
        // choice in the first place.
        const choiceAlreadyTerminal = this.choiceTerminalReasons.has(choiceIndex);

        if (choice.delta && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length > 0) {
          if (choiceAlreadyTerminal) {
            // Choice-local revocation: ANY meaningful tool-call evidence
            // for an already-terminal choice invalidates every already-
            // known call in that exact choice - not merely the specific
            // sourceKey this delta happens to reference. A brand-new tool
            // index never gets a coordinator call created for it at all
            // (see the non-terminal branch below), so a diagnostic against
            // ITS OWN sourceKey alone could sit forever unresolved in the
            // coordinator's pendingProtocolDiagnostics and disqualify
            // nothing - attaching to every sourceKey this adapter already
            // knows started under the choice is what actually reaches
            // real, coordinator-tracked calls. Scoped strictly to
            // allSourceKeysByChoice.get(choiceIndex): sibling choices are
            // never touched, and nothing here parses a choice index back
            // out of a sourceKey string.
            const known = this.allSourceKeysByChoice.get(choiceIndex);
            if (known && known.size > 0) {
              for (const sourceKey of known) {
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
                  severity: "error",
                  message: `Tool call evidence for choice ${choiceIndex} arrived after that choice's own finish_reason; call ${sourceKey} is disqualified`,
                });
              }
            } else {
              // No call was ever tracked for this choice at all (e.g. a
              // text-only choice that later receives a spurious tool_calls
              // delta) - nothing exists yet to disqualify, but the attempt
              // itself is still worth a forensic record against its own
              // (never-resolvable) sourceKey.
              for (const tc of choice.delta.tool_calls) {
                if (!Number.isInteger(tc.index) || tc.index < 0) continue;
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey: `choice:${choiceIndex}/tool-index:${tc.index}` },
                  code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
                  severity: "error",
                  message: `Tool call evidence for choice ${choiceIndex} arrived after that choice's own finish_reason`,
                });
              }
            }
            // Deliberately does not fall through to normal start/delta
            // processing below - a call is never started or mutated under
            // an already-terminal choice.
          } else {
          for (const tc of choice.delta.tool_calls) {
             if (!Number.isInteger(tc.index) || tc.index < 0) {
                events.push({
                  type: "provider_diagnostic",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  code: "E_PROVIDER_EVENT_MALFORMED",
                  severity: "error",
                  message: "tool_call index is missing or invalid",
                });
                continue;
             }

             const sourceKey = `choice:${choiceIndex}/tool-index:${tc.index}`;

             let openSet = this.openSourceKeysByChoice.get(choiceIndex);
             if (!openSet) {
               openSet = new Set();
               this.openSourceKeysByChoice.set(choiceIndex, openSet);
             }
             openSet.add(sourceKey);

             let knownSet = this.allSourceKeysByChoice.get(choiceIndex);
             if (!knownSet) {
               knownSet = new Set();
               this.allSourceKeysByChoice.set(choiceIndex, knownSet);
             }
             knownSet.add(sourceKey);

             if (!this.startedSourceKeys.has(sourceKey)) {
                this.startedSourceKeys.add(sourceKey);

                events.push({
                  type: "tool_call_start",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  toolIndex: tc.index,
                  toolCallId: tc.id,
                  name: tc.function?.name,
                });
             } else {
                // Send identity if ID provided late
                if (tc.id !== undefined) {
                   events.push({
                     type: "tool_call_identity",
                     sequence: ++this.sequence,
                     provider: this.provider,
                     callRef: { sourceKey },
                     toolCallId: tc.id,
                     toolIndex: tc.index,
                   });
                }

                // Name delta
                if (tc.function?.name) {
                  events.push({
                    type: "tool_call_name_delta",
                    sequence: ++this.sequence,
                    provider: this.provider,
                    callRef: { sourceKey },
                    delta: tc.function.name,
                  });
                }
             }

             // Arguments delta
             if (tc.function?.arguments) {
                events.push({
                  type: "tool_call_arguments_delta",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  delta: tc.function.arguments,
                });
             }
          }
          }
        }

        if (choice.finish_reason != null) {
          if (choiceAlreadyTerminal) {
            // A second, duplicate, or conflicting finish_reason for a
            // choice that already recorded one. Deliberately recorded
            // (never silently overwritten - choiceTerminalReasons keeps
            // its first-recorded value - and never silently ignored), but
            // NOT via TOOL_ARGUMENTS_AFTER_END: this is not tool-argument
            // evidence at all, it is a second CHOICE-terminal marker, a
            // materially different condition that code does not describe.
            // No existing coordinator diagnostic code represents "a
            // duplicate/conflicting CHOICE-level terminal" either (they are
            // all either call-scoped - e.g. DUPLICATE_TOOL_END, which is
            // specifically about a repeated end for the SAME CALL, not a
            // choice that may have zero calls - or stream-wide-provider_
            // stream_end-scoped - e.g. TERMINAL_REASON_CONFLICT/
            // EVENT_AFTER_STREAM_END, which describe the coordinator's own
            // handleStreamEnd() mechanic on a second provider_stream_end,
            // an event this adapter deliberately never emits from a single
            // choice). Inventing a new one was deliberately avoided.
            // Instead: record the fact locally (the sticky
            // choiceTerminalProtocolViolation flag, never reset) and let
            // finish()'s aggregation guarantee the fail-closed outcome -
            // see aggregateTermination() below, which forces the ONE
            // stream-wide reason to "provider_error" once this flag is
            // set, regardless of any individual choice's or the caller's
            // own claimed reason. This diagnostic itself is therefore pure
            // observability (not a member of AUTHORITY_PROTOCOL_VIOLATION_
            // CODES, not imported from the shared coordinator/diagnostic-
            // codes.ts registry - mirrors the existing adapter-local
            // "W_EVENT_AFTER_STREAM_END" pattern elsewhere in this file):
            // the actual fail-closed guarantee comes from the aggregate
            // reason, not from this event being specially recognized.
            this.choiceTerminalProtocolViolation = true;
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: "E_CHOICE_TERMINAL_PROTOCOL_VIOLATION",
              severity: "error",
              message: `choice ${choiceIndex} reported a second finish_reason ("${choice.finish_reason}") after already terminating with ("${this.choiceTerminalProviderReasons.get(choiceIndex)}") - the whole stream is now fail-closed`,
            });
          } else {
            const reason = mapFinishReason(choice.finish_reason);
            this.choiceTerminalReasons.set(choiceIndex, reason);
            this.choiceTerminalProviderReasons.set(choiceIndex, choice.finish_reason);

            const openSet = this.openSourceKeysByChoice.get(choiceIndex);
            if (openSet) {
              for (const sourceKey of openSet.values()) {
                events.push({
                  type: "tool_call_end",
                  sequence: ++this.sequence,
                  provider: this.provider,
                  callRef: { sourceKey },
                  reason,
                  providerReason: choice.finish_reason,
                });
              }
              openSet.clear();
            }
            // No provider_stream_end here, and `this.finished` stays
            // false: this choice finishing is not, by itself, proof the
            // whole provider stream (which may still have other choices
            // actively generating) has ended. See finish().
          }
        }
      }
    }

    return events;
  }

  finish(meta?: { reason?: StreamEndReason; providerReason?: string }): readonly NormalizedToolStreamEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const events: NormalizedToolStreamEvent[] = [];

    // Close any call whose own choice never got a chance to report its own
    // finish_reason at all before the caller's raw iterator ended.
    for (const openSet of this.openSourceKeysByChoice.values()) {
      for (const sourceKey of openSet.values()) {
        events.push({
          type: "tool_call_end",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey },
          reason: meta?.reason ?? "unknown",
          providerReason: meta?.providerReason,
        });
      }
      openSet.clear();
    }

    const { reason, providerReason } = this.aggregateTermination(meta?.reason, meta?.providerReason);
    events.push({
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason,
      providerReason,
    });
    return events;
  }

  // One stream-wide StreamEndReason from every choice-local reason
  // recorded so far, plus any caller-supplied override - "complete" only
  // if every single one of them was "complete". See REASON_PRIORITY.
  //
  // Paired with it: the raw providerReason string FROM WHICHEVER candidate
  // actually won that aggregation. The caller's own meta.providerReason is
  // used only when meta.reason is itself STRICTLY worse (a lower
  // REASON_PRIORITY index) than every recorded choice reason - e.g.
  // OpenRouterStreamAdapter's top-level-error shortcut, which calls
  // finish({reason:"provider_error", providerReason:"error"}) with no
  // choice having reported anything yet. A tie, or a less-severe caller
  // reason, keeps the specific choice-level raw string (e.g. "tool_calls")
  // instead of discarding it in favor of nothing - an ordinary
  // finish({reason:"complete"}) call from a drained raw iterator (or the
  // provider-envelopes conformance harness) commonly carries no
  // providerReason of its own at all, and dropping the one real, specific
  // string this adapter actually observed would be a pure loss of already
  //-available diagnostic fidelity, not a safety property: providerReason
  // is observability-only, never consulted by decideExecution() itself
  // (see decide.ts's own doc comment on DecisionEvidence.providerReason).
  private aggregateTermination(
    callerReason?: StreamEndReason,
    callerProviderReason?: string,
  ): { reason: StreamEndReason; providerReason?: string } {
    // A duplicated/conflicting CHOICE-level terminal was observed at some
    // point during push() (see the choiceAlreadyTerminal branch of
    // choice.finish_reason handling above). Unconditionally wins over
    // every other candidate below, INCLUDING an explicit caller-supplied
    // "complete" - a caller draining a raw iterator that already delivered
    // a protocol-violating duplicate terminal has no way to know that
    // violation occurred and must not be able to launder it away.
    // "provider_error" specifically (not just any low-priority reason)
    // because decide.ts's decision table checks
    // `ctx.streamEndReason === "provider_error"` unconditionally, before
    // any per-call status branching (see decide.ts's own file-header
    // comment) - the one reason value guaranteed to reject every call in
    // this stream regardless of how cleanly any individual call's own
    // evidence otherwise looks.
    if (this.choiceTerminalProtocolViolation) {
      return { reason: "provider_error", providerReason: "choice_terminal_protocol_violation" };
    }

    let worst: StreamEndReason | undefined;
    let worstRank = Infinity;
    let worstProviderReason: string | undefined;

    for (const [choiceIndex, candidate] of this.choiceTerminalReasons.entries()) {
      const rank = REASON_PRIORITY.indexOf(candidate);
      if (rank !== -1 && rank < worstRank) {
        worst = candidate;
        worstRank = rank;
        worstProviderReason = this.choiceTerminalProviderReasons.get(choiceIndex);
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
