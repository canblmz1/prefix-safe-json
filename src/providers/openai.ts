import { ProviderName, NormalizedToolStreamEvent, StreamEndReason } from "../coordinator/protocol.js";
import { ProviderStreamAdapter } from "./adapter.js";
import { OpenAICompatibleStreamAdapter } from "./openai-compatible.js";
import {
  CONTENT_FILTERED_DIAGNOSTIC_CODE,
  TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
  DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
  INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
  DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
} from "../coordinator/diagnostic-codes.js";

interface OpenAIFunctionCallDelta {
  name?: string;
  arguments?: string;
}

interface OpenAIChoice {
  // P4.3: required for legacy function_call choice-scoping - the
  // underlying Chat Completions choices[]/index wire structure is
  // identical between the plural and legacy singular tool-call shapes.
  index?: number;
  delta?: {
    function_call?: OpenAIFunctionCallDelta;
    tool_calls?: unknown;
  };
  finish_reason?: string | null;
}

// Reason priority for aggregating legacy per-choice terminal reasons into
// the ONE stream-wide reason, at adapter.finish() time. Mirrors
// OpenAICompatibleStreamAdapter's own REASON_PRIORITY exactly (same
// values, same order, same "worst wins" semantics: provider_error
// strongest, complete weakest) - duplicated locally rather than
// cross-imported so this file's production scope stays self-contained
// (P4.3: src/providers/openai.ts only, openai-compatible.ts unmodified).
const LEGACY_REASON_PRIORITY: readonly StreamEndReason[] = [
  "provider_error",
  "unknown",
  "network_error",
  "length",
  "cancelled",
  "complete",
];

function mapLegacyFinishReason(providerReason: string): StreamEndReason {
  if (providerReason === "stop" || providerReason === "function_call" || providerReason === "tool_calls") return "complete";
  if (providerReason === "length") return "length";
  if (providerReason === "cancelled") return "cancelled";
  return "unknown";
}

export interface OpenAIEvent {
  choices?: OpenAIChoice[];
  type?: string;
  output_index?: number;
  item?: {
    type?: string;
    id?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
  };
  item_id?: string;
  delta?: string;
  arguments?: string;
  response?: {
    status?: string;
    // Only populated when status is "incomplete". Confirmed against the
    // openai-node SDK's Response type: exactly "max_output_tokens" or
    // "content_filter" today - any other string is a future/unrecognized
    // value we haven't been taught to classify yet.
    incomplete_details?: {
      reason?: string;
    };
    // Only populated when status is "failed" (response.failed event).
    error?: {
      code?: string;
      message?: string;
    } | null;
  };
}

export class OpenAIStreamAdapter implements ProviderStreamAdapter<unknown> {
  readonly provider: ProviderName = "openai";
  private sequence = 0;
  
  // Delegating tool_calls format to compatible adapter
  private compatibleAdapter = new OpenAICompatibleStreamAdapter();
  
  // For the plural, new-style Chat Completions tool_calls format.
  // Sticky stream-mode flag: once ANY chunk in this stream shows genuine
  // plural tool_calls evidence (never inferred merely from finish_reason -
  // see the "no prior plural tool call" regression), every later Chat
  // Completions chunk continues through OpenAICompatibleStreamAdapter for
  // the rest of the stream's lifetime, including a later chunk whose own
  // delta carries no tool_calls at all - most commonly a separate
  // empty-delta finish_reason terminal chunk (see
  // test/integration/openai-official-sdk-lifecycle.test.ts for the exact
  // shape openai@7.8.0's own SDK parser exposes for it). Before this flag
  // existed, that terminal chunk failed the old per-chunk-only delegation
  // check and fell through into the unrelated legacy function_call loop
  // below, so the compatible adapter's own tracked call never received its
  // tool_call_end (see test/providers/openai-tool-calls-terminal-routing.test.ts).
  //
  // Only ever set once this.hasLegacyFunctionCall is confirmed false for
  // this stream - see push()'s own format-conflict check just above where
  // this flag is read/written. A stream can only ever genuinely commit to
  // ONE of the two Chat Completions tool-call shapes: conflicting evidence
  // for the other format fails the whole stream closed instead of
  // silently delegating to it (empirically confirmed necessary - a plural
  // tool_calls chunk arriving after a legacy function_call had already
  // started its own tracked call would otherwise delegate straight to
  // OpenAICompatibleStreamAdapter, which has no knowledge of the outer
  // adapter's legacy-tracked call and would happily track and correctly
  // close the injected plural evidence as its own, fully independent,
  // genuinely executable authority - see the "SYMMETRIC CASE" / "FORMAT-CONFLICT"
  // regressions).
  private hasCompatibleToolCalls = false;

  // For function_call (legacy). P4.3: choice-scoped identity and terminal
  // ownership - the pre-existing design used ONE fixed, global sourceKey
  // ("legacy-function-call") for every choice, so a genuine n>1 stream's
  // independent per-choice function_call evidence could merge into one
  // parser/identity (cross-choice argument/name injection - E-1), and a
  // later, entirely separate choice's evidence could collide with and
  // poison an earlier, already-legitimate choice's call (E-2). Ports the
  // SAME choice-local architecture already proven for the plural path in
  // OpenAICompatibleStreamAdapter (see that file's own class-level
  // lifecycle-contract doc) onto this legacy singular wire shape, which
  // has no array of tool_calls to key off - so per-choice state is
  // tracked directly here instead of delegating.
  //
  // hasLegacyFunctionCall keeps its ORIGINAL meaning unchanged: "has ANY
  // choice in this stream ever shown legacy function_call evidence" -
  // still used by the mixed-format conflict check above and by finish()'s
  // own branch-selection between this path and compatibleAdapter's.
  private hasLegacyFunctionCall = false;
  // choiceIndex -> is THAT choice's own legacy call's argument stream
  // currently open (started, not yet closed by ITS OWN finish_reason).
  private legacyChoiceOpen: Map<number, boolean> = new Map();
  // choiceIndex -> that choice's own first-recorded terminal StreamEndReason.
  // Never overwritten once set for a given choice - see Phase 10 handling
  // below. Read by finish() to aggregate one stream-wide reason.
  private legacyChoiceTerminalReasons: Map<number, StreamEndReason> = new Map();
  // The same choices' own RAW (pre-normalization) finish_reason strings,
  // keyed identically - observability only, mirrored onto the aggregated
  // provider_stream_end's own providerReason (see decide.ts's own doc
  // comment: "never consulted by the decision logic itself").
  private legacyChoiceTerminalProviderReasons: Map<number, string> = new Map();
  
  // For Responses API
  private accumulatedArguments = new Map<string, string>();
  private receivedDeltas = new Set<string>();
  // Item-local terminal state (P4.1 / F-2): every output-item id that has
  // already received its own `response.output_item.done`. Uses the exact
  // same identity as this adapter's own `output-item:{id}` sourceKey - no
  // second identity system. `output_item.done` closes the argument stream
  // choice-locally (tool_call_end), but that alone does not stop the
  // coordinator from silently merging a LATER, real
  // `response.function_call_arguments.delta`/`.done` for the SAME item_id
  // into the same still-"collecting" call (handleCallEnd never changes
  // call.status - see coordinator.ts). Recognized argument evidence for an
  // item already in this set is therefore hardened below instead of merged.
  private doneOutputItemIds = new Set<string>();
  
  private finished = false;

  push(rawEvent: unknown): readonly NormalizedToolStreamEvent[] {
    // No `finished` early return here: silently dropping every event after
    // the first terminal meant a late argument delta, a conflicting or
    // duplicate finish, or a provider error that arrived even one raw event
    // late never reached the coordinator at all - not even as a diagnostic -
    // so an already-decided call's authority could never be revoked by it.
    // Every case below that has ITS OWN meaningful post-terminal handling
    // (a genuine argument delta, a second output_item.added, a second
    // stream-terminal) still fires exactly as if the stream were open; the
    // coordinator's own `isFinished` gate (coordinator.ts's `push()`) is
    // what turns each of those into a sticky, stream-wide
    // AUTHORITY_PROTOCOL_VIOLATION_CODES diagnostic once it actually
    // receives them. Mirrors the fix already applied to AiSdkStreamAdapter
    // for the same invariant (GHSA-3xpw-9694-2xxp).
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

    const chunk = rawEvent as OpenAIEvent;
    
    // Handle Responses API
    if (chunk.type?.startsWith("response.") || chunk.type === "error") {
      if (chunk.type === "error") {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: "error",
        });
        this.finished = true;
        return events;
      }

      if (chunk.type === "response.failed") {
        events.push({
          type: "provider_stream_end",
          sequence: ++this.sequence,
          provider: this.provider,
          reason: "provider_error",
          providerReason: chunk.response?.error?.code ?? "response.failed",
        });
        this.finished = true;
        return events;
      }

      if (chunk.type === "response.output_item.added" && chunk.item?.type === "function_call" && chunk.item.id) {
        events.push({
          type: "tool_call_start",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey: `output-item:${chunk.item.id}` },
          toolCallId: chunk.item.call_id,
          name: chunk.item.name,
        });
      } else if (chunk.type === "response.function_call_arguments.delta" && chunk.item_id && chunk.delta) {
        if (this.doneOutputItemIds.has(chunk.item_id)) {
          // Item-local post-terminal evidence (P4.1 / F-2): this exact
          // item already recorded its own output_item.done. Never merge
          // further argument evidence as normal - that would silently
          // mutate (and, if left structurally unclosed at done time,
          // silently CLOSE) an already-ended item's value with no record
          // of the anomaly. Same diagnostic code AiSdkStreamAdapter/
          // OpenAICompatibleStreamAdapter already use for materially
          // identical semantics ("tool argument evidence arrived after
          // that call's end"), attributed to the item's own real,
          // already-tool_call_start'd sourceKey so the coordinator
          // resolves it to the actual call, not a phantom identity.
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey: `output-item:${chunk.item_id}` },
            code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
            severity: "error",
            message: `Tool call argument evidence for item ${chunk.item_id} arrived after that item's own output_item.done`,
          });
        } else {
          this.receivedDeltas.add(chunk.item_id);
          const acc = this.accumulatedArguments.get(chunk.item_id) ?? "";
          this.accumulatedArguments.set(chunk.item_id, acc + chunk.delta);

          events.push({
            type: "tool_call_arguments_delta",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey: `output-item:${chunk.item_id}` },
            delta: chunk.delta,
          });
        }
      } else if (chunk.type === "response.function_call_arguments.done" && chunk.item_id && chunk.arguments !== undefined) {
        if (this.doneOutputItemIds.has(chunk.item_id)) {
          // Same item-local post-terminal hardening as the `.delta` branch
          // above, for the `.done` (final-arguments) shape specifically.
          events.push({
            type: "provider_diagnostic",
            sequence: ++this.sequence,
            provider: this.provider,
            callRef: { sourceKey: `output-item:${chunk.item_id}` },
            code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
            severity: "error",
            message: `Tool call argument evidence for item ${chunk.item_id} arrived after that item's own output_item.done`,
          });
        } else {
          const acc = this.accumulatedArguments.get(chunk.item_id) ?? "";
          const hasDeltas = this.receivedDeltas.has(chunk.item_id);

          if (!hasDeltas && chunk.arguments.length > 0) {
            // No deltas, just final arguments.
            events.push({
              type: "tool_call_arguments_delta",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: `output-item:${chunk.item_id}` },
              delta: chunk.arguments,
            });
            this.accumulatedArguments.set(chunk.item_id, chunk.arguments);
          } else if (hasDeltas && chunk.arguments !== acc) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: `output-item:${chunk.item_id}` },
              code: "E_FINAL_ARGUMENTS_CONFLICT",
              severity: "error",
              message: "Final arguments do not match accumulated deltas",
            });
          }
        }
      } else if (chunk.type === "response.output_item.done" && chunk.item?.id) {
         this.doneOutputItemIds.add(chunk.item.id);
         events.push({
           type: "tool_call_end",
           sequence: ++this.sequence,
           provider: this.provider,
           callRef: { sourceKey: `output-item:${chunk.item.id}` },
           reason: "complete", // Default complete for item done
         });
      } else if (chunk.type === "response.completed") {
         events.push({
           type: "provider_stream_end",
           sequence: ++this.sequence,
           provider: this.provider,
           reason: "complete",
           providerReason: chunk.response?.status,
         });
         this.finished = true;
      } else if (chunk.type === "response.incomplete") {
         const incompleteReason = chunk.response?.incomplete_details?.reason;
         if (incompleteReason === "max_output_tokens") {
           // An explicit provider-native output-budget signal: a positively
           // observed truncation, not a generic cancellation. Any call still
           // "collecting" when this arrives must fail closed even if its own
           // JSON happens to look syntactically complete (see isExecutable()
           // in parser.ts) - a coincidentally-closed value from a stream the
           // provider itself says it cut short is not confirmation of intent.
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "length",
             providerReason: incompleteReason,
           });
         } else if (incompleteReason === "content_filter") {
           // A policy/safety termination, not a retryable interruption:
           // recorded as its own diagnostic so the execution gate rejects
           // with "content_filtered" instead of the generic "stream_incomplete"
           // a bare "cancelled" end reason would otherwise produce. Mirrors
           // the same finish_reason === "content-filter" handling in
           // ai-sdk.ts.
           events.push({
             type: "provider_diagnostic",
             sequence: ++this.sequence,
             provider: this.provider,
             code: CONTENT_FILTERED_DIAGNOSTIC_CODE,
             severity: "error",
             message: "Generation stopped by the model provider's content filter",
           });
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "cancelled",
             providerReason: incompleteReason,
           });
         } else {
           // incomplete_details missing, or a reason string this adapter
           // doesn't recognize (e.g. a future OpenAI addition): fail closed
           // on "unknown" rather than mislabeling it as "cancelled", which
           // would wrongly imply a user/API-initiated cancellation instead
           // of an unclassified provider-side termination.
           events.push({
             type: "provider_stream_end",
             sequence: ++this.sequence,
             provider: this.provider,
             reason: "unknown",
             providerReason: incompleteReason ?? chunk.response?.status,
           });
         }
         this.finished = true;
      }
      return events;
    }

    // This chunk's OWN evidence for each Chat Completions tool-call format,
    // independent of any mode already committed to by an earlier chunk.
    // Checked across every choice, not only choices[0]: a multi-choice
    // (n>1) stream's tool call can legitimately live in a non-zero choice.
    const hasPluralEvidence = Array.isArray(chunk.choices) && chunk.choices.some(choice => choice.delta?.tool_calls !== undefined);
    const hasLegacyEvidence = Array.isArray(chunk.choices) && chunk.choices.some(choice => choice.delta?.function_call !== undefined);

    // A stream can only ever genuinely be ONE Chat Completions tool-call
    // format. Conflicting evidence - both shapes in the SAME chunk, or one
    // format's evidence arriving after the OTHER was already committed to
    // by an earlier chunk - must never silently pick a winner while
    // letting the original, already-legitimate call keep its authority
    // (that was the exact gap the earlier hasLegacyFunctionCall-only cross
    // check left open - see the SYMMETRIC CASE / plural-then-singular
    // regressions). It fails the WHOLE stream closed instead: same as
    // every other meaningful evidence this method recognizes, there is no
    // `if (this.finished) return` guard here, so this branch also runs -
    // and correctly revokes an already-live, not-yet-consumed decision -
    // when the conflicting evidence arrives AFTER a clean terminal already
    // fired. That revocation is the coordinator's own isFinished protocol
    // converting this second stream-end-shaped event into its sticky,
    // stream-wide diagnostic (GHSA-3xpw-9694-2xxp) - this adapter does not
    // track post-conflict state itself beyond the ordinary `finished` flag.
    if ((hasPluralEvidence && hasLegacyEvidence) || (hasPluralEvidence && this.hasLegacyFunctionCall) || (hasLegacyEvidence && this.hasCompatibleToolCalls)) {
      events.push({
        type: "provider_stream_end",
        sequence: ++this.sequence,
        provider: this.provider,
        reason: "provider_error",
        providerReason: "mixed_tool_call_formats",
      });
      this.finished = true;
      return events;
    }

    if (hasPluralEvidence) {
      this.hasCompatibleToolCalls = true;
    }
    if (this.hasCompatibleToolCalls) {
      // Delegate to OpenAICompatibleStreamAdapter
      const compatibleEvents = this.compatibleAdapter.push(rawEvent);
      // Map provider name to "openai"
      return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
    }

    // Handle legacy function_call format (P4.3: choice-scoped - see the
    // field-level doc comments above for the full rationale).
    if (Array.isArray(chunk.choices)) {
      // Duplicate-index detection within one chunk - mirrors
      // OpenAICompatibleStreamAdapter's own choiceCounts pre-pass exactly,
      // reused because the underlying choices[]/index wire structure is
      // identical between plural and legacy singular tool-call shapes.
      const choiceCounts = new Map<number, number>();
      for (const choice of chunk.choices) {
        if (Number.isInteger(choice.index) && (choice.index as number) >= 0) {
          const choiceIndex = choice.index as number;
          choiceCounts.set(choiceIndex, (choiceCounts.get(choiceIndex) ?? 0) + 1);
        }
      }

      for (const choice of chunk.choices) {
        // Choice-index validity (Phase 5): a legacy function_call-bearing
        // choice with no trustworthy explicit index must never be
        // silently assumed to be choice 0 - global, unattributable, fails
        // the whole stream closed rather than guessing (same fail-closed
        // posture INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE already has for
        // the plural path - reused rather than inventing a new code,
        // since the identity ambiguity it represents is identical here).
        // A finish_reason-only choice (no function_call evidence at all)
        // with an invalid index carries no legacy identity to protect and
        // is simply skipped, not diagnosed - out of this fix's scope.
        if (!Number.isInteger(choice.index) || (choice.index as number) < 0) {
          if (choice.delta?.function_call) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              code: INVALID_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: "legacy function_call choice.index is missing, non-integer, or negative; choice identity is ambiguous",
            });
          }
          continue;
        }
        const choiceIndex = choice.index as number;

        if ((choiceCounts.get(choiceIndex) ?? 0) > 1) {
          if (choice.delta?.function_call) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey: `legacy-choice:${choiceIndex}` },
              code: DUPLICATE_CHOICE_INDEX_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice.index ${choiceIndex} is duplicated in one provider event`,
            });
          }
          continue;
        }

        const sourceKey = `legacy-choice:${choiceIndex}`;

        if (choice.delta?.function_call) {
          const fc = choice.delta.function_call;
          const isKnownChoice = this.legacyChoiceOpen.has(choiceIndex);
          // Choice-local post-terminal evidence: this exact choice's
          // legacy call was already closed (its own finish_reason, or a
          // direct adapter.finish() force-close). Guards BOTH the
          // call-start path below AND the name/arguments-delta path -
          // `isKnownChoice` alone (the original, insufficient check) only
          // ever distinguished "genuinely new call" from "continuing
          // call," never "continuing an OPEN call" from "evidence for an
          // already-CLOSED one," which would otherwise let a late
          // argument/name delta silently mutate (and, if left
          // structurally unclosed at close time, silently CLOSE) an
          // already-ended choice's value with no record of the anomaly -
          // the same class of gap already hardened for OpenAI Responses
          // (P4.1) and Anthropic (P4.2). Same diagnostic code those two
          // use for materially identical semantics.
          if (isKnownChoice && this.legacyChoiceOpen.get(choiceIndex) === false) {
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey },
              code: TOOL_ARGUMENTS_AFTER_END_DIAGNOSTIC_CODE,
              severity: "error",
              message: `Tool call evidence for choice ${choiceIndex} arrived after that choice's own finish_reason`,
            });
          } else {
            if (!isKnownChoice) {
              this.hasLegacyFunctionCall = true;
              this.legacyChoiceOpen.set(choiceIndex, true);
              events.push({
                type: "tool_call_start",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                toolIndex: choiceIndex,
                name: fc.name,
              });
            } else if (fc.name) {
              events.push({
                type: "tool_call_name_delta",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                delta: fc.name,
              });
            }

            if (fc.arguments) {
              events.push({
                type: "tool_call_arguments_delta",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                delta: fc.arguments,
              });
            }
          }
        }

        if (choice.finish_reason != null) {
          const alreadyTerminal = this.legacyChoiceTerminalReasons.has(choiceIndex);
          if (alreadyTerminal) {
            // Duplicate/conflicting terminal for the SAME choice (Phase
            // 10): never silently overwrite the first-recorded reason.
            // Exactly DUPLICATE_TOOL_END_DIAGNOSTIC_CODE's own documented
            // meaning ("more than one end part for the same call") - this
            // choice's own finish_reason IS what closes its legacy call,
            // so a second one is genuinely a repeated end signal for that
            // same call. Attributed to this choice's own real sourceKey
            // only: exact attribution is possible here, so per this
            // fix's own design this stays choice-local and does not
            // poison unrelated sibling choices - distinct from the
            // separate, already-approved stream-wide design used for the
            // analogous plural-path anomaly in openai-compatible.ts.
            events.push({
              type: "provider_diagnostic",
              sequence: ++this.sequence,
              provider: this.provider,
              callRef: { sourceKey },
              code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
              severity: "error",
              message: `choice ${choiceIndex} received a second finish_reason ("${choice.finish_reason}") after already terminating`,
            });
          } else if (this.finished) {
            // Post-blocker-fix: this choice was already closed by a PRIOR
            // adapter.finish() call - force-closed via that method's own
            // loop, which never touches legacyChoiceTerminalReasons (only
            // legacyChoiceOpen - see finish()) - so `alreadyTerminal` above
            // is false even though the adapter has already globally
            // terminated. The ORIGINAL bug: silently recording this
            // reason and returning nothing meant this late, recognized
            // terminal evidence never reached the coordinator at all -
            // not even as a diagnostic - so an already-computed, still-
            // UNCONSUMED execute decision could never be revoked by it.
            // Exactly the class of gap this file's own push() doc comment
            // already promises never to reintroduce ("No `finished` early
            // return here: silently dropping every event after the first
            // terminal meant ... an already-decided call's authority
            // could never be revoked by it").
            //
            // Reuses DUPLICATE_TOOL_END_DIAGNOSTIC_CODE rather than
            // inventing a new mechanism: this choice's call already has
            // an end (finish()'s own synthetic close), so a further,
            // later terminal for the SAME choice is genuinely a second
            // end signal for that same call - semantically identical to
            // the in-stream duplicate-finish_reason case above. No new
            // security mechanism is implemented here: coordinator.ts's
            // own push() unconditionally converts ANY event arriving
            // after its OWN isFinished flag into a sticky, stream-wide
            // AUTHORITY_PROTOCOL_VIOLATION_CODES diagnostic
            // (EVENT_AFTER_STREAM_END_DIAGNOSTIC_CODE, or
            // TERMINAL_REASON_CONFLICT_DIAGNOSTIC_CODE for a genuinely
            // conflicting provider_stream_end) regardless of this event's
            // own code - this only needs to stop being silence. Never
            // reopens/modifies legacyChoiceOpen/legacyChoiceTerminalReasons
            // (that state is frozen the moment finish() ran) and never
            // emits a second normal tool_call_end, which would look like
            // ordinary in-stream evidence rather than a flagged anomaly.
            //
            // Only emitted when this exact choice had prior tracked
            // activity (legacyChoiceOpen.has) - a finish_reason for a
            // choice index that was never referenced at all carries no
            // existing authority to protect, and is left exactly as
            // before (silently ignored, matching the invalid-index
            // choice's own "no identity to protect" design elsewhere in
            // this file).
            if (this.legacyChoiceOpen.has(choiceIndex)) {
              events.push({
                type: "provider_diagnostic",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                code: DUPLICATE_TOOL_END_DIAGNOSTIC_CODE,
                severity: "error",
                message: `choice ${choiceIndex} received a finish_reason ("${choice.finish_reason}") after the adapter had already globally terminated via finish()`,
              });
            }
          } else {
            const reason = mapLegacyFinishReason(choice.finish_reason);
            this.legacyChoiceTerminalReasons.set(choiceIndex, reason);
            this.legacyChoiceTerminalProviderReasons.set(choiceIndex, choice.finish_reason);

            if (this.legacyChoiceOpen.get(choiceIndex)) {
              events.push({
                type: "tool_call_end",
                sequence: ++this.sequence,
                provider: this.provider,
                callRef: { sourceKey },
                reason,
                providerReason: choice.finish_reason,
              });
              this.legacyChoiceOpen.set(choiceIndex, false);
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
    
    const compatibleEvents = this.compatibleAdapter.finish(meta);
    if (compatibleEvents.length > 0 && !this.hasLegacyFunctionCall) {
       return compatibleEvents.map(e => ({ ...e, provider: this.provider, sequence: ++this.sequence }));
    }

    const events: NormalizedToolStreamEvent[] = [];
    // Close any legacy choice whose call never got a chance to report its
    // own finish_reason at all before the caller's raw iterator ended.
    // Marks each one closed (mirrors OpenAICompatibleStreamAdapter's own
    // `openSet.clear()` in its analogous finish() loop) - without this, a
    // stray later push() for the SAME choice (still reachable: there is
    // deliberately no top-of-push() `finished` guard, see GHSA-3xpw-9694-
    // 2xxp) would find `legacyChoiceOpen` still true and emit a SECOND,
    // spurious tool_call_end for a call this adapter already closed here.
    for (const [choiceIndex, open] of this.legacyChoiceOpen.entries()) {
      if (open) {
        events.push({
          type: "tool_call_end",
          sequence: ++this.sequence,
          provider: this.provider,
          callRef: { sourceKey: `legacy-choice:${choiceIndex}` },
          reason: meta?.reason ?? "unknown",
          providerReason: meta?.providerReason,
        });
        this.legacyChoiceOpen.set(choiceIndex, false);
      }
    }

    const { reason, providerReason } = this.aggregateLegacyTermination(meta?.reason, meta?.providerReason);
    events.push({
      type: "provider_stream_end",
      sequence: ++this.sequence,
      provider: this.provider,
      reason,
      providerReason,
    });
    return events;
  }

  // One stream-wide StreamEndReason from every legacy choice-local reason
  // recorded so far, plus any caller-supplied override - "complete" only
  // if every single one of them was "complete". Mirrors
  // OpenAICompatibleStreamAdapter's own aggregateTermination() exactly
  // (see LEGACY_REASON_PRIORITY above for why it is duplicated locally
  // rather than cross-imported).
  private aggregateLegacyTermination(
    callerReason?: StreamEndReason,
    callerProviderReason?: string,
  ): { reason: StreamEndReason; providerReason?: string } {
    let worst: StreamEndReason | undefined;
    let worstRank = Infinity;
    let worstProviderReason: string | undefined;

    for (const [choiceIndex, candidate] of this.legacyChoiceTerminalReasons.entries()) {
      const rank = LEGACY_REASON_PRIORITY.indexOf(candidate);
      if (rank !== -1 && rank < worstRank) {
        worst = candidate;
        worstRank = rank;
        worstProviderReason = this.legacyChoiceTerminalProviderReasons.get(choiceIndex);
      }
    }

    if (callerReason !== undefined) {
      const rank = LEGACY_REASON_PRIORITY.indexOf(callerReason);
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
