"""LangChain v1 AgentMiddleware implementation for the cutoff guard."""
from __future__ import annotations

from typing import Any, Collection, Mapping

from langchain_core.messages import AIMessage

from .guard import guard_cut_off_tool_calls

try:
    from langchain.agents.middleware import AgentMiddleware as _BaseAgentMiddleware
except ImportError:  # pragma: no cover - optional langchain>=1.0.0 dependency
    _BaseAgentMiddleware = object  # type: ignore[assignment, misc]


class CutoffGuardMiddleware(_BaseAgentMiddleware):  # type: ignore[misc]
    """LangChain v1 ``AgentMiddleware`` that blocks cut-off streamed tool calls.

    Hooks ``after_model`` / ``aafter_model`` so that if the model's final
    ``AIMessage`` carries ``tool_calls`` without a confirmed complete stop
    reason (e.g. ``finish_reason='length'``, ``stop_reason='max_tokens'``,
    ``status='incomplete'``, or missing ``finish_reason`` after a dropped
    stream), those calls are moved to ``invalid_tool_calls`` before any tool
    node can execute them.
    """

    def __init__(
        self,
        *,
        allowed_finish_reasons: Collection[str] | None = None,
    ) -> None:
        super().__init__()
        self.allowed_finish_reasons = allowed_finish_reasons

    def after_model(
        self,
        state: Any,
        runtime: Any = None,
    ) -> dict[str, Any] | None:
        """Inspect the last ``AIMessage`` and block unconfirmed tool calls."""
        messages = (
            state.get("messages")
            if isinstance(state, Mapping)
            else getattr(state, "messages", None)
        )
        if not messages:
            return None
        last = messages[-1]
        if not isinstance(last, AIMessage):
            return None
        guarded = guard_cut_off_tool_calls(
            last,
            allowed_finish_reasons=self.allowed_finish_reasons,
        )
        if guarded is last:
            return None
        return {"messages": [guarded]}

    async def aafter_model(
        self,
        state: Any,
        runtime: Any = None,
    ) -> dict[str, Any] | None:
        """Async counterpart to :meth:`after_model`."""
        return self.after_model(state, runtime)
