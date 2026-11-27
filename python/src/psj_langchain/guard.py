"""Fail-closed cutoff guard for streamed LangChain/LangGraph tool calls."""
from __future__ import annotations

import json
from enum import Enum
from typing import Any, Callable, Collection, Mapping

from langchain_core.messages import AIMessage
from langchain_core.messages.tool import invalid_tool_call

# Normalized (lowercase) finish/stop reasons that positively confirm the model
# finished generating tool calls without hitting a token limit or dropping.
DEFAULT_ALLOWED_FINISH_REASONS: frozenset[str] = frozenset(
    {
        "stop",
        "tool_calls",
        "function_call",
        "tool_use",
        "end_turn",
        "stop_sequence",
        "completed",
        "complete",
    }
)

# Normalized (lowercase) finish/stop reasons indicating output truncation.
TRUNCATION_FINISH_REASONS: frozenset[str] = frozenset(
    {
        "length",
        "max_tokens",
        "max_token",
        "max_output_tokens",
        "model_context_window_exceeded",
        "incomplete",
    }
)

# OpenAI Responses API `status` values that indicate an unfinished or failed response.
INCOMPLETE_STATUS_VALUES: frozenset[str] = frozenset(
    {
        "in_progress",
        "queued",
        "incomplete",
        "failed",
        "cancelled",
        "canceled",
    }
)

FINISH_REASON_KEYS: tuple[str, ...] = (
    "finish_reason",
    "stop_reason",
    "stopReason",
    "done_reason",
)


def _normalize_reason(value: Any) -> str | None:
    """Convert a string or Enum finish reason to lowercase text, or None if invalid."""
    if isinstance(value, Enum):
        value = value.value if isinstance(value.value, str) else value.name
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped.lower() if stripped else None


def _extract_incomplete_reason(details: Any) -> str | None:
    if isinstance(details, Mapping):
        reason = details.get("reason")
        return str(reason) if reason is not None else None
    reason = getattr(details, "reason", None)
    return str(reason) if reason is not None else None


def _check_status_value(
    norm_status: str,
    allowed: frozenset[str],
    incomplete_details: Any,
) -> tuple[bool, str | None]:
    if norm_status == "incomplete":
        detail = _extract_incomplete_reason(incomplete_details)
        suffix = f" ({detail})" if detail else ""
        return False, f"response status is 'incomplete'{suffix}"
    if norm_status in ("in_progress", "queued"):
        return False, f"stream ended before completion (status={norm_status!r})"
    if norm_status in INCOMPLETE_STATUS_VALUES:
        return False, f"response did not complete (status={norm_status!r})"
    if norm_status not in allowed:
        return False, f"unrecognized or unsafe response status {norm_status!r}"
    return True, None


def inspect_completion(
    response_metadata: Mapping[str, Any] | None,
    *,
    allowed_finish_reasons: Collection[str] | None = None,
) -> tuple[bool, str | None]:
    """Check whether ``response_metadata`` positively confirms completion.

    Fails closed: returns ``(True, None)`` only when the provider metadata
    contains an explicit, allowed completion signal and no truncation or
    unfinished-stream indicators. Otherwise returns ``(False, explanation)``.
    """
    if not isinstance(response_metadata, Mapping):
        return False, "missing response_metadata (stream ended without completion signal)"

    allowed = (
        DEFAULT_ALLOWED_FINISH_REASONS
        if allowed_finish_reasons is None
        else frozenset(r.strip().lower() for r in allowed_finish_reasons if r and r.strip())
    )

    incomplete_details = response_metadata.get("incomplete_details")
    if incomplete_details:
        detail = _extract_incomplete_reason(incomplete_details)
        suffix = f" ({detail})" if detail else ""
        return False, f"model output was truncated{suffix}"

    if response_metadata.get("done") is False:
        return False, "stream ended with done=False before completion"

    present_finishes: list[tuple[str, Any]] = []
    for key in FINISH_REASON_KEYS:
        if key in response_metadata and response_metadata[key] is not None:
            raw_val = response_metadata[key]
            if isinstance(raw_val, str) and not raw_val.strip():
                continue
            present_finishes.append((key, raw_val))

    has_status = "status" in response_metadata and response_metadata["status"] is not None
    raw_status = response_metadata.get("status") if has_status else None
    norm_status: str | None = None
    if has_status and not (isinstance(raw_status, str) and not raw_status.strip()):
        norm_status = _normalize_reason(raw_status)
        if norm_status is None:
            return False, f"non-string response status {raw_status!r}"
        ok, status_err = _check_status_value(norm_status, allowed, incomplete_details)
        if not ok:
            return False, status_err

    if not present_finishes:
        if norm_status is not None:
            return True, None
        return (
            False,
            "missing finish_reason in response_metadata (stream ended without a completion signal)",
        )

    for key, raw_val in present_finishes:
        norm = _normalize_reason(raw_val)
        if norm is None:
            return False, f"unrecognized non-string {key}={raw_val!r}"
        if norm in TRUNCATION_FINISH_REASONS:
            return False, f"output token limit reached ({key}={raw_val!r})"
        if norm not in allowed:
            return False, f"unconfirmed or unsafe completion ({key}={raw_val!r})"

    return True, None


def _extract_raw_args(message: AIMessage, tool_call: Mapping[str, Any]) -> str:
    """Recover the original JSON argument string when available, else serialize ``args``."""
    call_id = tool_call.get("id")
    raw_calls = message.additional_kwargs.get("tool_calls")
    if isinstance(raw_calls, list) and call_id is not None:
        for entry in raw_calls:
            if not isinstance(entry, Mapping) or entry.get("id") != call_id:
                continue
            fn = entry.get("function")
            if isinstance(fn, Mapping) and isinstance(fn.get("arguments"), str):
                return fn["arguments"]

    args = tool_call.get("args")
    if isinstance(args, str):
        return args
    try:
        return json.dumps(args if args is not None else {}, ensure_ascii=False)
    except TypeError:
        return str(args)


def guard_cut_off_tool_calls(
    message: AIMessage,
    *,
    allowed_finish_reasons: Collection[str] | None = None,
) -> AIMessage:
    """Move ``tool_calls`` to ``invalid_tool_calls`` unless completion is confirmed.

    Designed for LangGraph's ``create_react_agent(..., post_model_hook=...)`` and
    custom agent loops. Fails closed: if ``message`` carries tool calls and its
    ``response_metadata`` indicates truncation (e.g. ``finish_reason='length'``
    or Anthropic ``stop_reason='max_tokens'``) or lacks a confirmed completion
    signal (e.g. a dropped stream), every tool call is moved into
    ``invalid_tool_calls`` with an explanatory error so tools are never executed
    with repaired partial JSON and the model is informed.

    Returns ``message`` unchanged if it has no ``tool_calls`` or completion is
    positively confirmed.
    """
    if not isinstance(message, AIMessage) or not message.tool_calls:
        return message

    is_complete, reason = inspect_completion(
        message.response_metadata,
        allowed_finish_reasons=allowed_finish_reasons,
    )
    if is_complete:
        return message

    moved = [
        invalid_tool_call(
            name=tc.get("name"),
            args=_extract_raw_args(message, tc),
            id=tc.get("id"),
            error=(
                f"Tool call {tc.get('name')!r} was blocked and NOT executed: "
                f"{reason}. Arguments may be truncated; retry with smaller output "
                f"or split the task."
            ),
        )
        for tc in message.tool_calls
    ]

    existing_invalid = list(message.invalid_tool_calls or [])
    new_additional = dict(message.additional_kwargs or {})
    new_additional.pop("tool_calls", None)
    new_additional.pop("function_call", None)

    return message.model_copy(
        update={
            "tool_calls": [],
            "invalid_tool_calls": existing_invalid + moved,
            "additional_kwargs": new_additional,
        }
    )


def make_post_model_hook(
    *,
    allowed_finish_reasons: Collection[str] | None = None,
) -> Callable[[Mapping[str, Any]], dict[str, Any]]:
    """Create a ``post_model_hook`` for ``langgraph.prebuilt.create_react_agent``."""

    def _hook(state: Mapping[str, Any]) -> dict[str, Any]:
        messages = state.get("messages") if isinstance(state, Mapping) else getattr(state, "messages", None)
        if not messages:
            return {}
        last = messages[-1]
        if not isinstance(last, AIMessage):
            return {}
        guarded = guard_cut_off_tool_calls(
            last,
            allowed_finish_reasons=allowed_finish_reasons,
        )
        if guarded is last:
            return {}
        return {"messages": [guarded]}

    return _hook


post_model_cutoff_guard = make_post_model_hook()
