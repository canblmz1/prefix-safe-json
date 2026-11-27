"""Fail-closed cutoff guard for LangChain and LangGraph streamed tool calls."""
from __future__ import annotations

from .guard import (
    DEFAULT_ALLOWED_FINISH_REASONS,
    TRUNCATION_FINISH_REASONS,
    guard_cut_off_tool_calls,
    inspect_completion,
    make_post_model_hook,
    post_model_cutoff_guard,
)
from .middleware import CutoffGuardMiddleware

__version__ = "0.1.0"

__all__ = [
    "CutoffGuardMiddleware",
    "DEFAULT_ALLOWED_FINISH_REASONS",
    "TRUNCATION_FINISH_REASONS",
    "__version__",
    "guard_cut_off_tool_calls",
    "inspect_completion",
    "make_post_model_hook",
    "post_model_cutoff_guard",
]
