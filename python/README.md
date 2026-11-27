# prefix-safe-json-langchain

Fail-closed cutoff guard for streamed LangChain and LangGraph tool calls.

## Why this exists

When LangChain streams a tool call (for example `ChatOpenAI(..., streaming=True)`) and the response hits its output-token limit (`finish_reason="length"` / `stop_reason="max_tokens"`) or the HTTP stream ends early without a finish signal, `langchain-core` repairs the truncated JSON arguments using `parse_partial_json` (`langchain-ai/langchain#41285`).

LangGraph's `ToolNode` then executes the repaired partial arguments as if they were complete. In [agent-faultbench](https://github.com/simin-yuan/agent-faultbench)'s `cutoff` suite (`write_file` expecting 40 lines / 2,120 bytes), streaming `ChatOpenAI` wrote **866 of 2,120 bytes** to disk and the agent returned `"Done."` with no error.

`psj_langchain` adds a **fail-closed** post-model guard that inspects `AIMessage.response_metadata` before tool execution. Any `tool_calls` on an `AIMessage` without a positively confirmed completion signal are moved into `invalid_tool_calls` with an explanatory error, so the tool never runs and the model is told why.

## Install

Experimental and not on PyPI yet. Install it from this repository:

```bash
pip install "prefix-safe-json-langchain @ git+https://github.com/canblmz1/prefix-safe-json#subdirectory=python"
```

If you use `CutoffGuardMiddleware` with LangChain v1 (`langchain.agents.create_agent`), add the `middleware` extra (or install `langchain>=1.0.0`):

```bash
pip install "prefix-safe-json-langchain[middleware] @ git+https://github.com/canblmz1/prefix-safe-json#subdirectory=python"
```

Requires Python `>=3.10` and `langchain-core>=0.3.0`.

## Usage

### 1. LangChain v1 `create_agent` middleware (`CutoffGuardMiddleware`)

```python
from langchain.agents import create_agent
from langchain_openai import ChatOpenAI
from psj_langchain import CutoffGuardMiddleware

llm = ChatOpenAI(model="gpt-4o", streaming=True)
agent = create_agent(
    model=llm,
    tools=[write_file],
    middleware=[CutoffGuardMiddleware()],
)
```

Works with both synchronous (`agent.invoke(...)`) and asynchronous (`await agent.ainvoke(...)`) runs via `after_model` and `aafter_model`.

### 2. LangGraph `create_react_agent` (`post_model_cutoff_guard` / `make_post_model_hook`)

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from psj_langchain import post_model_cutoff_guard

llm = ChatOpenAI(model="gpt-4o", streaming=True)
agent = create_react_agent(
    llm,
    [write_file],
    post_model_hook=post_model_cutoff_guard,
)
```

To customize allowed finish reasons:

```python
from psj_langchain import DEFAULT_ALLOWED_FINISH_REASONS, make_post_model_hook

hook = make_post_model_hook(
    allowed_finish_reasons=DEFAULT_ALLOWED_FINISH_REASONS | {"my_provider_done"}
)
```

### 3. Custom agent loops (`guard_cut_off_tool_calls`)

```python
from psj_langchain import guard_cut_off_tool_calls

ai_message = guard_cut_off_tool_calls(llm_with_tools.invoke(messages))
# If ai_message was truncated or lacked a completion signal:
#   ai_message.tool_calls == []
#   ai_message.invalid_tool_calls == [InvalidToolCall(...)]
```

## Fail-closed completion policy

`guard_cut_off_tool_calls` checks `message.response_metadata` whenever `message.tool_calls` is non-empty:

| Provider / signal | Passed (`tool_calls` kept) | Blocked (moved to `invalid_tool_calls`) |
| --- | --- | --- |
| OpenAI Chat Completions | `finish_reason` in `{"tool_calls", "stop", "function_call"}` | `"length"`, `"content_filter"`, missing/`None`/`""`, unknown |
| OpenAI Responses API | `status="completed"` (and no `incomplete_details`) | `status="incomplete"`, `incomplete_details` truthy, `status="in_progress"`, missing `status` & `finish_reason` |
| Anthropic | `stop_reason` in `{"tool_use", "end_turn", "stop_sequence"}` | `"max_tokens"`, `"model_context_window_exceeded"`, missing |
| Google Gemini | `finish_reason="STOP"` (case-insensitive) | `"MAX_TOKENS"`, `"MALFORMED_FUNCTION_CALL"`, `"SAFETY"`, missing |
| AWS Bedrock / Ollama / Cohere | `stopReason="tool_use"` / `done_reason="stop"` / `finish_reason="COMPLETE"` | `"max_tokens"` / `done_reason="length"` / `done=False` / missing |

Any unknown or missing completion signal is rejected by default (**fail closed**).

## Limits (provider honesty)

This guard inspects LangChain's `AIMessage.response_metadata` rather than re-parsing raw HTTP/SSE frames. If a proxy or provider mislabels a truncated response with `finish_reason="tool_calls"` or `status="completed"`, metadata-level inspection cannot detect that discrepancy. For raw wire-level SSE verification in Node.js/TypeScript, see the [root package](../README.md).

## Running tests

From `python/` (using the local `.venv` or an environment with `pytest`, `langchain`, `langgraph`, and `langchain-openai` installed):

```bash
cd python
.venv/Scripts/python.exe -m pytest -v   # Windows
# .venv/bin/python -m pytest -v         # macOS / Linux
```

The end-to-end tests in `tests/test_e2e_cutoff.py` start `afb/suites/cutoff/server.py` locally on an ephemeral port (no API key or external network access required during tests). Set `CUTOFF_SERVER_PATH` if the `afb` checkout lives outside the sibling scratchpad path.

## License

Licensed under either of [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
