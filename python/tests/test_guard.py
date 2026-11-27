"""Unit tests for psj_langchain cutoff guard and middleware."""
from __future__ import annotations

import asyncio
import json

import pytest
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import AIMessage, HumanMessage, ToolCall
from langchain_core.messages.tool import invalid_tool_call
from langgraph.graph.message import add_messages

from psj_langchain import (
    DEFAULT_ALLOWED_FINISH_REASONS,
    CutoffGuardMiddleware,
    guard_cut_off_tool_calls,
    inspect_completion,
    make_post_model_hook,
    post_model_cutoff_guard,
)


def _ai_msg(
    *,
    tool_calls: list[ToolCall] | None = None,
    invalid_tool_calls: list[dict] | None = None,
    response_metadata: dict | None = None,
    additional_kwargs: dict | None = None,
    msg_id: str = "msg-1",
) -> AIMessage:
    return AIMessage(
        id=msg_id,
        content="",
        tool_calls=tool_calls if tool_calls is not None else [],
        invalid_tool_calls=invalid_tool_calls or [],
        response_metadata=response_metadata if response_metadata is not None else {},
        additional_kwargs=additional_kwargs or {},
    )


def _sample_tc(call_id: str = "call_1", name: str = "write_file") -> ToolCall:
    return ToolCall(
        name=name,
        args={"path": "report.txt", "content": "line 1\nline 2"},
        id=call_id,
    )


class TestPassThrough:
    def test_no_tool_calls_passes_even_with_length_or_empty_metadata(self) -> None:
        msg_len = _ai_msg(response_metadata={"finish_reason": "length"})
        msg_empty = _ai_msg(response_metadata={})
        assert guard_cut_off_tool_calls(msg_len) is msg_len
        assert guard_cut_off_tool_calls(msg_empty) is msg_empty

    def test_non_ai_message_passes_through_defensively(self) -> None:
        human = HumanMessage(content="hello")
        assert guard_cut_off_tool_calls(human) is human  # type: ignore[arg-type]

    @pytest.mark.parametrize(
        "metadata",
        [
            {"finish_reason": "tool_calls"},
            {"finish_reason": "stop"},
            {"finish_reason": "function_call"},
            {"stop_reason": "tool_use"},
            {"stop_reason": "end_turn"},
            {"stop_reason": "stop_sequence"},
            {"finish_reason": "STOP"},
            {"status": "completed"},
            {"stopReason": "tool_use"},
            {"done_reason": "stop"},
            {"finish_reason": "COMPLETE"},
        ],
    )
    def test_valid_complete_finish_reasons_keep_tool_calls(self, metadata: dict) -> None:
        msg = _ai_msg(tool_calls=[_sample_tc()], response_metadata=metadata)
        out = guard_cut_off_tool_calls(msg)
        assert out is msg
        assert len(out.tool_calls) == 1
        assert out.invalid_tool_calls == []


class TestFailClosedBlocking:
    @pytest.mark.parametrize(
        ("metadata", "expected_fragment"),
        [
            ({"finish_reason": "length"}, "finish_reason='length'"),
            ({"stop_reason": "max_tokens"}, "stop_reason='max_tokens'"),
            (
                {"stop_reason": "model_context_window_exceeded"},
                "model_context_window_exceeded",
            ),
            ({"finish_reason": "MAX_TOKENS"}, "MAX_TOKENS"),
            ({"finish_reason": "MALFORMED_FUNCTION_CALL"}, "MALFORMED_FUNCTION_CALL"),
            ({"stopReason": "max_tokens"}, "stopReason='max_tokens'"),
            ({"done_reason": "length"}, "done_reason='length'"),
            ({"done": False, "done_reason": "stop"}, "done=False"),
            (
                {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}},
                "max_output_tokens",
            ),
            ({"status": "incomplete"}, "incomplete"),
            ({"status": "in_progress"}, "in_progress"),
            ({}, "missing finish_reason"),
            ({"finish_reason": None}, "missing finish_reason"),
            ({"finish_reason": ""}, "missing finish_reason"),
            (
                {"finish_reason": "tool_calls", "incomplete_details": {"reason": "max_output_tokens"}},
                "max_output_tokens",
            ),
            ({"finish_reason": "tool_calls", "status": "incomplete"}, "incomplete"),
            ({"finish_reason": "content_filter"}, "content_filter"),
            ({"finish_reason": "weird_unknown_reason"}, "weird_unknown_reason"),
        ],
    )
    def test_blocks_truncated_missing_conflicting_and_unknown_reasons(
        self, metadata: dict, expected_fragment: str
    ) -> None:
        raw_tc = {
            "id": "call_1",
            "type": "function",
            "function": {"name": "write_file", "arguments": '{"path":"report.txt","content":"line 1'},
        }
        msg = _ai_msg(
            tool_calls=[_sample_tc()],
            response_metadata=metadata,
            additional_kwargs={"tool_calls": [raw_tc]},
            msg_id="ai-123",
        )

        out = guard_cut_off_tool_calls(msg)
        assert out is not msg
        assert out.id == "ai-123"
        assert out.tool_calls == []
        assert "tool_calls" not in out.additional_kwargs
        assert len(out.invalid_tool_calls) == 1

        inv = out.invalid_tool_calls[0]
        assert inv["name"] == "write_file"
        assert inv["id"] == "call_1"
        assert inv["args"] == '{"path":"report.txt","content":"line 1'
        assert "blocked and NOT executed" in (inv["error"] or "")
        assert expected_fragment in (inv["error"] or "")

    def test_multiple_tool_calls_all_moved_and_existing_invalid_preserved(self) -> None:
        pre_existing = invalid_tool_call(
            name="other", args="{bad", id="call_0", error="prior error"
        )
        tc1 = _sample_tc("call_1", "write_file")
        tc2 = ToolCall(name="delete_file", args={"path": "x.txt"}, id="call_2")
        msg = _ai_msg(
            tool_calls=[tc1, tc2],
            invalid_tool_calls=[pre_existing],
            response_metadata={"finish_reason": "length"},
            additional_kwargs={
                "tool_calls": [
                    {
                        "id": "call_1",
                        "function": {"name": "write_file", "arguments": '{"path":"report.txt"'},
                    }
                ]
            },
        )

        out = guard_cut_off_tool_calls(msg)
        assert out.tool_calls == []
        assert len(out.invalid_tool_calls) == 3
        assert out.invalid_tool_calls[0] == pre_existing
        assert out.invalid_tool_calls[1]["id"] == "call_1"
        assert out.invalid_tool_calls[1]["args"] == '{"path":"report.txt"'
        assert out.invalid_tool_calls[2]["id"] == "call_2"
        assert json.loads(out.invalid_tool_calls[2]["args"] or "{}") == {"path": "x.txt"}

    def test_custom_allowed_finish_reasons(self) -> None:
        custom = DEFAULT_ALLOWED_FINISH_REASONS | {"custom_done"}
        ok_msg = _ai_msg(tool_calls=[_sample_tc()], response_metadata={"finish_reason": "custom_done"})
        assert guard_cut_off_tool_calls(ok_msg, allowed_finish_reasons=custom) is ok_msg

        bad_msg = _ai_msg(tool_calls=[_sample_tc()], response_metadata={"finish_reason": "length"})
        guarded = guard_cut_off_tool_calls(bad_msg, allowed_finish_reasons=custom)
        assert guarded.tool_calls == []
        assert len(guarded.invalid_tool_calls) == 1

    def test_inspect_completion_none_metadata(self) -> None:
        ok, reason = inspect_completion(None)
        assert ok is False
        assert reason is not None


class TestHooksAndMiddleware:
    def test_middleware_is_agent_middleware_subclass(self) -> None:
        mw = CutoffGuardMiddleware()
        assert isinstance(mw, AgentMiddleware)

    def test_middleware_sync_and_async_hooks(self) -> None:
        mw = CutoffGuardMiddleware()
        ok_msg = _ai_msg(
            tool_calls=[_sample_tc()],
            response_metadata={"finish_reason": "tool_calls"},
        )
        assert mw.after_model({"messages": [ok_msg]}) is None
        assert asyncio.run(mw.aafter_model({"messages": [ok_msg]})) is None

        cut_msg = _ai_msg(
            tool_calls=[_sample_tc()],
            response_metadata={"finish_reason": "length"},
            msg_id="cut-1",
        )
        sync_update = mw.after_model({"messages": [cut_msg]})
        async_update = asyncio.run(mw.aafter_model({"messages": [cut_msg]}))
        assert sync_update is not None
        assert async_update is not None
        assert len(sync_update["messages"]) == 1
        assert sync_update["messages"][0].tool_calls == []
        assert len(sync_update["messages"][0].invalid_tool_calls) == 1
        assert async_update["messages"][0].id == "cut-1"

    def test_post_model_hook_replaces_message_in_add_messages_reducer(self) -> None:
        cut_msg = _ai_msg(
            tool_calls=[_sample_tc()],
            response_metadata={},
            msg_id="drop-1",
        )
        update = post_model_cutoff_guard({"messages": [cut_msg]})
        assert "messages" in update
        merged = add_messages([cut_msg], update["messages"])
        assert len(merged) == 1
        assert merged[0].id == "drop-1"
        assert merged[0].tool_calls == []
        assert len(merged[0].invalid_tool_calls) == 1

    def test_make_post_model_hook_returns_empty_dict_when_unchanged(self) -> None:
        hook = make_post_model_hook()
        ok_msg = _ai_msg(
            tool_calls=[_sample_tc()],
            response_metadata={"finish_reason": "tool_calls"},
        )
        assert hook({"messages": [ok_msg]}) == {}
        assert hook({"messages": []}) == {}
