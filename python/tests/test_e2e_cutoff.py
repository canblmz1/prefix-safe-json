"""End-to-end tests against the real agent-faultbench cutoff server."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from typing import Iterator

import pytest
from langchain.agents import create_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.errors import GraphRecursionError
from langgraph.prebuilt import create_react_agent

from psj_langchain import CutoffGuardMiddleware, post_model_cutoff_guard

TARGET = "report.txt"
COMPLETE_BYTES = 2120
TRUNCATED_BYTES = 866


def _resolve_server_path() -> Path:
    env_path = os.environ.get("CUTOFF_SERVER_PATH")
    if env_path:
        return Path(env_path)
    return Path(__file__).resolve().parent / "fixtures" / "cutoff_server.py"


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="session")
def cutoff_server_url() -> Iterator[str]:
    server_path = _resolve_server_path()
    if not server_path.exists():
        pytest.skip(f"cutoff server not found at {server_path}")

    port = _free_port()
    proc = subprocess.Popen(
        [sys.executable, "-I", str(server_path), str(port)],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    base_url = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 10.0
        ready = False
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                output = proc.stdout.read() if proc.stdout else ""
                raise RuntimeError(f"cutoff server exited early ({proc.returncode}): {output}")
            try:
                with urllib.request.urlopen(f"{base_url}/complete/v1/models", timeout=1.0) as resp:
                    if resp.status == 200:
                        ready = True
                        break
            except Exception:
                time.sleep(0.05)
        if not ready:
            raise TimeoutError(f"cutoff server on {base_url} did not become ready")
        yield base_url
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5.0)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5.0)


def _make_write_tool(workdir: Path, calls: list[dict]):
    @tool
    def write_file(path: str, content: str) -> str:
        """Write content to a file."""
        calls.append({"path": path, "content_chars": len(content)})
        target = workdir / Path(path).name
        target.write_text(content, encoding="utf-8", newline="\n")
        return f"Wrote {len(content)} characters to {target.name}"

    return write_file


def _make_llm(base_url: str, mode: str, api: str) -> ChatOpenAI:
    return ChatOpenAI(
        model="bench-model",
        base_url=f"{base_url}/{mode}/v1",
        api_key="sk-bench",
        streaming=True,
        use_responses_api=(api == "responses"),
        max_retries=0,
    )


def _bytes_on_disk(workdir: Path) -> int:
    target = workdir / TARGET
    return len(target.read_bytes()) if target.exists() else 0


@pytest.mark.parametrize("api", ["chat", "responses"])
@pytest.mark.parametrize(
    ("mode", "expected_unguarded", "expected_guarded"),
    [
        ("complete", COMPLETE_BYTES, COMPLETE_BYTES),
        ("length", TRUNCATED_BYTES, 0),
        ("drop", TRUNCATED_BYTES, 0),
    ],
)
def test_langgraph_create_react_agent_e2e(
    cutoff_server_url: str,
    tmp_path: Path,
    api: str,
    mode: str,
    expected_unguarded: int,
    expected_guarded: int,
) -> None:
    # Unguarded baseline: reproduces upstream langchain-core#41285 truncation execution
    unguarded_dir = tmp_path / "unguarded"
    unguarded_dir.mkdir()
    unguarded_calls: list[dict] = []
    unguarded_agent = create_react_agent(
        _make_llm(cutoff_server_url, mode, api),
        [_make_write_tool(unguarded_dir, unguarded_calls)],
    )
    unguarded_agent.invoke(
        {"messages": [("user", "Write the 40-line report to report.txt.")]},
        {"recursion_limit": 6},
    )
    assert _bytes_on_disk(unguarded_dir) == expected_unguarded

    # Guarded via post_model_cutoff_guard
    guarded_dir = tmp_path / "guarded"
    guarded_dir.mkdir()
    guarded_calls: list[dict] = []
    guarded_agent = create_react_agent(
        _make_llm(cutoff_server_url, mode, api),
        [_make_write_tool(guarded_dir, guarded_calls)],
        post_model_hook=post_model_cutoff_guard,
    )
    out = None
    try:
        out = guarded_agent.invoke(
            {"messages": [("user", "Write the 40-line report to report.txt.")]},
            {"recursion_limit": 6},
        )
    except GraphRecursionError:
        # The cutoff server (tests/fixtures/cutoff_server.py) reuses static id="resp_bench" across Turn 1 and
        # Turn 2 on /v1/responses; add_messages replaces Turn 1's AIMessage in-place so
        # messages[-1] stays a ToolMessage and langgraph_prebuilt's post_model_hook_router
        # loops back to "agent" after write_file already executed.
        if not (api == "responses" and mode == "complete"):
            raise
    assert _bytes_on_disk(guarded_dir) == expected_guarded

    if out is None:
        assert len(guarded_calls) == 1
        return

    ai_msgs = [m for m in out["messages"] if m.type == "ai"]
    invalid_count = sum(len(getattr(m, "invalid_tool_calls", []) or []) for m in ai_msgs)
    if expected_guarded == 0:
        assert guarded_calls == []
        assert not (guarded_dir / TARGET).exists()
        assert invalid_count >= 1
        first_invalid = next(
            tc for m in ai_msgs for tc in (getattr(m, "invalid_tool_calls", []) or [])
        )
        assert "blocked and NOT executed" in (first_invalid.get("error") or "")
    else:
        assert len(guarded_calls) == 1
        assert invalid_count == 0


@pytest.mark.parametrize("api", ["chat", "responses"])
@pytest.mark.parametrize(
    ("mode", "expected_unguarded", "expected_guarded"),
    [
        ("complete", COMPLETE_BYTES, COMPLETE_BYTES),
        ("length", TRUNCATED_BYTES, 0),
        ("drop", TRUNCATED_BYTES, 0),
    ],
)
def test_langchain_create_agent_middleware_e2e(
    cutoff_server_url: str,
    tmp_path: Path,
    api: str,
    mode: str,
    expected_unguarded: int,
    expected_guarded: int,
) -> None:
    # Unguarded baseline
    unguarded_dir = tmp_path / "unguarded"
    unguarded_dir.mkdir()
    unguarded_calls: list[dict] = []
    unguarded_agent = create_agent(
        model=_make_llm(cutoff_server_url, mode, api),
        tools=[_make_write_tool(unguarded_dir, unguarded_calls)],
    )
    unguarded_agent.invoke(
        {"messages": [{"role": "user", "content": "Write the 40-line report to report.txt."}]},
        {"recursion_limit": 6},
    )
    assert _bytes_on_disk(unguarded_dir) == expected_unguarded

    # Guarded via CutoffGuardMiddleware
    guarded_dir = tmp_path / "guarded"
    guarded_dir.mkdir()
    guarded_calls: list[dict] = []
    guarded_agent = create_agent(
        model=_make_llm(cutoff_server_url, mode, api),
        tools=[_make_write_tool(guarded_dir, guarded_calls)],
        middleware=[CutoffGuardMiddleware()],
    )
    out = guarded_agent.invoke(
        {"messages": [{"role": "user", "content": "Write the 40-line report to report.txt."}]},
        {"recursion_limit": 6},
    )
    assert _bytes_on_disk(guarded_dir) == expected_guarded

    ai_msgs = [m for m in out["messages"] if m.type == "ai"]
    invalid_count = sum(len(getattr(m, "invalid_tool_calls", []) or []) for m in ai_msgs)
    if expected_guarded == 0:
        assert guarded_calls == []
        assert not (guarded_dir / TARGET).exists()
        assert invalid_count >= 1
    else:
        assert len(guarded_calls) == 1
        assert invalid_count == 0


@pytest.mark.parametrize(
    ("mode", "expected_bytes"),
    [
        ("complete", COMPLETE_BYTES),
        ("length", 0),
        ("drop", 0),
    ],
)
def test_langchain_create_agent_middleware_async_e2e(
    cutoff_server_url: str,
    tmp_path: Path,
    mode: str,
    expected_bytes: int,
) -> None:
    import asyncio

    workdir = tmp_path / "async_guarded"
    workdir.mkdir()
    calls: list[dict] = []
    agent = create_agent(
        model=_make_llm(cutoff_server_url, mode, "chat"),
        tools=[_make_write_tool(workdir, calls)],
        middleware=[CutoffGuardMiddleware()],
    )
    out = asyncio.run(
        agent.ainvoke(
            {"messages": [{"role": "user", "content": "Write the 40-line report to report.txt."}]},
            {"recursion_limit": 6},
        )
    )
    assert _bytes_on_disk(workdir) == expected_bytes
    if expected_bytes == 0:
        assert calls == []
        ai_msgs = [m for m in out["messages"] if m.type == "ai"]
        assert sum(len(getattr(m, "invalid_tool_calls", []) or []) for m in ai_msgs) >= 1
    else:
        assert len(calls) == 1
