import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  guardChatOpenAI,
  LangChainGuardRefusal,
  type LangChainToolLike,
} from "../../src/langchain.js";

interface RunningServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

const activeServers: RunningServer[] = [];

async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void | Promise<void>,
): Promise<RunningServer> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void handler(req, res, Buffer.concat(chunks).toString("utf8"));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  const running: RunningServer = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
  activeServers.push(running);
  return running;
}

afterEach(async () => {
  while (activeServers.length > 0) {
    const srv = activeServers.pop();
    if (srv) await srv.close();
  }
});

function chatSseFrame(payload: unknown): string {
  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  return `data: ${data}\n\n`;
}

function makeChatToolCallFrames(options: {
  readonly id?: string;
  readonly name?: string;
  readonly argChunks: readonly string[];
  readonly finishReason?: string | null;
  readonly includeDone?: boolean;
}): string[] {
  const base = { id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "test-model" };
  const frames: string[] = [
    chatSseFrame({
      ...base,
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                ...(options.id !== undefined ? { id: options.id } : {}),
                type: "function",
                function: { ...(options.name !== undefined ? { name: options.name } : {}), arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    }),
  ];
  for (const part of options.argChunks) {
    frames.push(
      chatSseFrame({
        ...base,
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, function: { arguments: part } }] },
            finish_reason: null,
          },
        ],
      }),
    );
  }
  if (options.finishReason !== undefined && options.finishReason !== null) {
    frames.push(
      chatSseFrame({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: options.finishReason }],
      }),
    );
  }
  if (options.includeDone ?? true) {
    frames.push(chatSseFrame("[DONE]"));
  }
  return frames;
}

function makeWriteTool(
  impl: (args: { path: string; content: string }) => unknown,
  schema: unknown = z.object({ path: z.string(), content: z.string() }),
): LangChainToolLike {
  return {
    name: "write_file",
    description: "Write a file.",
    schema,
    invoke(input) {
      const payload =
        input && typeof input === "object" && (input as { type?: unknown }).type === "tool_call"
          ? (input as { args: { path: string; content: string } }).args
          : (input as { path: string; content: string });
      return impl(payload);
    },
  };
}

describe("prefix-safe-json/langchain (guardChatOpenAI)", () => {
  it("allows complete Chat Completions SSE tool call and records turn result", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_1",
      name: "write_file",
      argChunks: ['{"path":"report.txt",', '"content":"hello world"}'],
      finishReason: "tool_calls",
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(frames.join(""));
    });

    const spy = vi.fn((args: { path: string; content: string }) => `wrote ${args.path}`);
    const onTurnResult = vi.fn();
    const guard = guardChatOpenAI({ onTurnResult });
    const tool = guard.guardTool(makeWriteTool(spy));

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await resp.text();

    const args = { path: "report.txt", content: "hello world" };
    const out = await tool.invoke({ type: "tool_call", id: "call_1", name: "write_file", args });
    expect(out).toBe("wrote report.txt");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(args);

    const turn = guard.lastTurnResult();
    expect(turn?.protocol).toBe("sse");
    expect(turn?.decisions).toHaveLength(1);
    expect(turn?.decisions[0]?.action).toBe("execute");
    expect(onTurnResult).toHaveBeenCalledTimes(1);
    expect(onTurnResult).toHaveBeenCalledWith(turn);
  });

  // The OpenAI SDK stops at `[DONE]` and cancels the body instead of reading to
  // EOF. These servers keep the connection open so only the cancel ends the turn.
  async function readUntilThenCancel(resp: Response, marker: string): Promise<void> {
    if (!resp.body) throw new Error("response has no body");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes(marker)) {
      const next = await reader.read();
      if (next.done) break;
      text += decoder.decode(next.value, { stream: true });
    }
    await reader.cancel();
  }

  it("allows a complete Chat Completions call when the client cancels the body after [DONE]", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_done",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"hello"}'],
      finishReason: "tool_calls",
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(frames.join(""));
    });

    const spy = vi.fn(() => "ok");
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await readUntilThenCancel(resp, "[DONE]");

    const args = { path: "report.txt", content: "hello" };
    const out = await tool.invoke({ type: "tool_call", id: "call_done", name: "write_file", args });
    expect(out).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses when the client cancels the body before [DONE]", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_early",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"hello"}'],
      finishReason: "tool_calls",
      includeDone: false,
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(frames.join(""));
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await readUntilThenCancel(resp, '"finish_reason":"tool_calls"');

    const args = { path: "report.txt", content: "hello" };
    expect(() => tool.invoke({ type: "tool_call", id: "call_early", name: "write_file", args })).toThrow(
      LangChainGuardRefusal,
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses Chat Completions SSE cut off by finish_reason='length' (even with repaired projection)", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_cut",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"line 01\\nline 17: the quick'],
      finishReason: "length",
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(frames.join(""));
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await resp.text();

    const repairedArgs = { path: "report.txt", content: "line 01\nline 17: the quick" };
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_cut", name: "write_file", args: repairedArgs }),
    ).toThrow(LangChainGuardRefusal);
    expect(spy).not.toHaveBeenCalled();

    try {
      tool.invoke({ type: "tool_call", id: "call_cut", name: "write_file", args: repairedArgs });
    } catch (error) {
      expect(error).toBeInstanceOf(LangChainGuardRefusal);
      expect((error as LangChainGuardRefusal).reason).toBe("truncated");
      expect((error as LangChainGuardRefusal).toolCallId).toBe("call_cut");
    }
  });

  it("refuses syntactically complete JSON when finish_reason='length'", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_len_json",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"complete-looking"}'],
      finishReason: "length",
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(frames.join(""));
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const [tool] = guard.guardTools([makeWriteTool(spy)]);
    expect(tool).toBeDefined();
    if (!tool) return;

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await resp.text();

    let caught: unknown;
    try {
      tool.invoke({
        type: "tool_call",
        id: "call_len_json",
        name: "write_file",
        args: { path: "report.txt", content: "complete-looking" },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LangChainGuardRefusal);
    expect((caught as LangChainGuardRefusal).reason).toBe("stream_incomplete");
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses clean EOF drop with no finish_reason and no [DONE]", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_drop",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"half'],
      finishReason: null,
      includeDone: false,
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(frames.join(""));
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    await resp.text();

    expect(() =>
      tool.invoke({
        type: "tool_call",
        id: "call_drop",
        name: "write_file",
        args: { path: "report.txt", content: "half" },
      }),
    ).toThrow(LangChainGuardRefusal);
    expect(spy).not.toHaveBeenCalled();
  });

  it("refuses on abrupt TCP socket reset / transport error", async () => {
    const frames = makeChatToolCallFrames({
      id: "call_reset",
      name: "write_file",
      argChunks: ['{"path":"report.txt","content":"half'],
      finishReason: null,
      includeDone: false,
    });
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(frames.join(""));
      // Force an abrupt mid-stream socket destruction.
      res.socket?.destroy();
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    // Depending on timing, the reset surfaces before the headers (fetch
    // rejects) or while reading the body (text() rejects). Either way the
    // call must stay refused.
    const read = guard
      .fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" })
      .then((resp) => resp.text());
    await expect(read).rejects.toThrow();

    expect(() =>
      tool.invoke({
        type: "tool_call",
        id: "call_reset",
        name: "write_file",
        args: { path: "report.txt", content: "half" },
      }),
    ).toThrow(LangChainGuardRefusal);
    expect(spy).not.toHaveBeenCalled();
  });

  it("streams SSE bytes incrementally before the response reaches EOF", async () => {
    let releaseTail!: () => void;
    const tailGate = new Promise<void>((resolve) => {
      releaseTail = resolve;
    });

    const srv = await startServer(async (_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        chatSseFrame({
          id: "chatcmpl-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { role: "assistant", content: "Hello " }, finish_reason: null }],
        }),
      );
      await tailGate;
      res.write(
        chatSseFrame({
          id: "chatcmpl-stream",
          object: "chat.completion.chunk",
          created: 1,
          model: "test-model",
          choices: [{ index: 0, delta: { content: "world" }, finish_reason: "stop" }],
        }),
      );
      res.write(chatSseFrame("[DONE]"));
      res.end();
    });

    const guard = guardChatOpenAI();
    const resp = await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" });
    const reader = resp.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;

    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(new TextDecoder().decode(first.value)).toContain("Hello ");

    releaseTail();
    while (!(await reader.read()).done) {
      // Drain remainder
    }
    expect(guard.lastTurnResult()?.protocol).toBe("sse");
  });

  it("handles split UTF-8 bytes and CRLF frame boundaries, and fails closed on invalid UTF-8", async () => {
    const validFrames = makeChatToolCallFrames({
      id: "call_utf8",
      name: "write_file",
      argChunks: ['{"path":"€-note.txt","content":"ok"}'],
      finishReason: "tool_calls",
    })
      .join("")
      .replaceAll("\n\n", "\r\n\r\n");

    const rawBytes = Buffer.from(validFrames, "utf8");
    const euroByteOffset = rawBytes.indexOf(Buffer.from("€", "utf8"));
    expect(euroByteOffset).toBeGreaterThan(0);

    const srv = await startServer(async (req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (req.url === "/bad-utf8") {
        res.write(Buffer.from([0x64, 0x61, 0x74, 0x61, 0x3a, 0x20, 0xff, 0x0a, 0x0a]));
        res.end();
        return;
      }
      // Split directly inside the 3-byte € UTF-8 sequence and later inside \r\n\r\n.
      res.write(rawBytes.subarray(0, euroByteOffset + 1));
      await new Promise((r) => setTimeout(r, 5));
      res.write(rawBytes.subarray(euroByteOffset + 1, rawBytes.length - 2));
      await new Promise((r) => setTimeout(r, 5));
      res.write(rawBytes.subarray(rawBytes.length - 2));
      res.end();
    });

    const spy = vi.fn(() => "ok");
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    const okResp = await guard.fetch(`${srv.baseUrl}/ok`, { method: "POST" });
    await okResp.text();
    expect(
      tool.invoke({
        type: "tool_call",
        id: "call_utf8",
        name: "write_file",
        args: { path: "€-note.txt", content: "ok" },
      }),
    ).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);

    const badResp = await guard.fetch(`${srv.baseUrl}/bad-utf8`, { method: "POST" });
    await badResp.text();
    expect(guard.lastTurnResult()?.framingError).toBe("invalid_utf8");
  });

  it("refuses duplicate tool_call_id, evidence after [DONE], unfinished SSE frame, and in-band provider errors", async () => {
    const base = { id: "c", object: "chat.completion.chunk", created: 1, model: "m" };
    const srv = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (req.url === "/dup-id") {
        res.write(
          chatSseFrame({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_dup", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt","content":"1"}' } },
                    { index: 1, id: "call_dup", type: "function", function: { name: "write_file", arguments: '{"path":"b.txt","content":"2"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        );
        res.end(chatSseFrame("[DONE]"));
        return;
      }
      if (req.url === "/after-done") {
        res.write(
          makeChatToolCallFrames({
            id: "call_ad",
            name: "write_file",
            argChunks: ['{"path":"a.txt","content":"1"}'],
            finishReason: "tool_calls",
            includeDone: true,
          }).join(""),
        );
        res.end(chatSseFrame({ ...base, choices: [{ index: 0, delta: { content: "late" }, finish_reason: null }] }));
        return;
      }
      if (req.url === "/unfinished-frame") {
        const frames = makeChatToolCallFrames({
          id: "call_uf",
          name: "write_file",
          argChunks: ['{"path":"a.txt","content":"1"}'],
          finishReason: "tool_calls",
          includeDone: false,
        });
        res.write(frames.join(""));
        // Trailing data line without closing \n\n
        res.end('data: {"trailing":true}');
        return;
      }
      res.write(
        makeChatToolCallFrames({
          id: "call_err",
          name: "write_file",
          argChunks: ['{"path":"a.txt","content":"1"}'],
          finishReason: null,
          includeDone: false,
        }).join(""),
      );
      res.write(chatSseFrame({ error: { message: "upstream failure" } }));
      res.end(chatSseFrame("[DONE]"));
    });

    const spy = vi.fn();
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    // Duplicate ID
    await (await guard.fetch(`${srv.baseUrl}/dup-id`, { method: "POST" })).text();
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_dup", name: "write_file", args: { path: "a.txt", content: "1" } }),
    ).toThrow(expect.objectContaining({ reason: "protocol_violation" }));

    // Evidence after [DONE]
    await (await guard.fetch(`${srv.baseUrl}/after-done`, { method: "POST" })).text();
    expect(guard.lastTurnResult()?.framingError).toBe("evidence_after_done");
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_ad", name: "write_file", args: { path: "a.txt", content: "1" } }),
    ).toThrow(expect.objectContaining({ reason: "evidence_after_done" }));

    // Unfinished SSE frame
    await (await guard.fetch(`${srv.baseUrl}/unfinished-frame`, { method: "POST" })).text();
    expect(guard.lastTurnResult()?.framingError).toBe("unfinished_sse_event");
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_uf", name: "write_file", args: { path: "a.txt", content: "1" } }),
    ).toThrow(LangChainGuardRefusal);

    // In-band provider error
    await (await guard.fetch(`${srv.baseUrl}/provider-err`, { method: "POST" })).text();
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_err", name: "write_file", args: { path: "a.txt", content: "1" } }),
    ).toThrow(LangChainGuardRefusal);

    expect(spy).not.toHaveBeenCalled();
  });

  it("supports OpenAI Responses API SSE (complete executes; incomplete/content_filter/drop refuse)", async () => {
    const sse = (type: string, data: Record<string, unknown>) =>
      `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;

    const srv = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(sse("response.created", { response: { status: "in_progress" } }));
      res.write(
        sse("response.output_item.added", {
          output_index: 0,
          item: { type: "function_call", id: "fc_1", call_id: "call_resp_1", name: "write_file", arguments: "" },
        }),
      );
      if (req.url === "/complete") {
        res.write(
          sse("response.function_call_arguments.delta", {
            output_index: 0,
            item_id: "fc_1",
            delta: '{"path":"resp.txt","content":"ok"}',
          }),
        );
        res.write(
          sse("response.function_call_arguments.done", {
            output_index: 0,
            item_id: "fc_1",
            arguments: '{"path":"resp.txt","content":"ok"}',
          }),
        );
        res.write(sse("response.output_item.done", { output_index: 0, item: { id: "fc_1" } }));
        res.end(sse("response.completed", { response: { status: "completed" } }));
        return;
      }
      if (req.url === "/incomplete") {
        res.write(
          sse("response.function_call_arguments.delta", {
            output_index: 0,
            item_id: "fc_1",
            delta: '{"path":"resp.txt","content":"cut',
          }),
        );
        res.end(
          sse("response.incomplete", {
            response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } },
          }),
        );
        return;
      }
      if (req.url === "/content-filter") {
        res.write(
          sse("response.function_call_arguments.delta", {
            output_index: 0,
            item_id: "fc_1",
            delta: '{"path":"resp.txt","content":"ok"}',
          }),
        );
        res.end(
          sse("response.incomplete", {
            response: { status: "incomplete", incomplete_details: { reason: "content_filter" } },
          }),
        );
        return;
      }
      // /drop: no terminal event
      res.end(
        sse("response.function_call_arguments.delta", {
          output_index: 0,
          item_id: "fc_1",
          delta: '{"path":"resp.txt","content":"ok"}',
        }),
      );
    });

    const spy = vi.fn(() => "done");
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    await (await guard.fetch(`${srv.baseUrl}/complete`, { method: "POST" })).text();
    expect(
      tool.invoke({
        type: "tool_call",
        id: "call_resp_1",
        name: "write_file",
        args: { path: "resp.txt", content: "ok" },
      }),
    ).toBe("done");
    expect(spy).toHaveBeenCalledTimes(1);

    for (const [path, content, reason] of [
      ["/incomplete", "cut", "truncated"],
      ["/content-filter", "ok", "content_filtered"],
      ["/drop", "ok", "malformed"],
    ] as const) {
      await (await guard.fetch(`${srv.baseUrl}${path}`, { method: "POST" })).text();
      expect(() =>
        tool.invoke({
          type: "tool_call",
          id: "call_resp_1",
          name: "write_file",
          args: { path: "resp.txt", content },
        }),
      ).toThrow(expect.objectContaining({ reason }));
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("supports non-streaming JSON for Chat Completions and Responses API, and revokes on HTTP error", async () => {
    const srv = await startServer((req, res) => {
      if (req.url === "/error-500") {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "server error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/chat-complete") {
        res.end(
          JSON.stringify({
            id: "cmpl-1",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_json_1",
                      type: "function",
                      function: { name: "write_file", arguments: '{"path":"j.txt","content":"ok"}' },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/chat-length") {
        res.end(
          JSON.stringify({
            id: "cmpl-2",
            object: "chat.completion",
            choices: [
              {
                index: 0,
                finish_reason: "length",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_json_2",
                      type: "function",
                      function: { name: "write_file", arguments: '{"path":"j.txt","content":"cut' },
                    },
                  ],
                },
              },
            ],
          }),
        );
        return;
      }
      if (req.url === "/responses-complete") {
        res.end(
          JSON.stringify({
            id: "resp-1",
            object: "response",
            status: "completed",
            output: [
              {
                type: "function_call",
                id: "fc_j1",
                call_id: "call_rj1",
                name: "write_file",
                status: "completed",
                arguments: '{"path":"rj.txt","content":"ok"}',
              },
            ],
          }),
        );
        return;
      }
      res.end(
        JSON.stringify({
          id: "resp-2",
          object: "response",
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [
            {
              type: "function_call",
              id: "fc_j2",
              call_id: "call_rj2",
              name: "write_file",
              status: "incomplete",
              arguments: '{"path":"rj.txt","content":"cut',
            },
          ],
        }),
      );
    });

    const spy = vi.fn(() => "ok");
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    await (await guard.fetch(`${srv.baseUrl}/chat-complete`, { method: "POST" })).json();
    expect(
      tool.invoke({ type: "tool_call", id: "call_json_1", name: "write_file", args: { path: "j.txt", content: "ok" } }),
    ).toBe("ok");

    await (await guard.fetch(`${srv.baseUrl}/chat-length`, { method: "POST" })).json();
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_json_2", name: "write_file", args: { path: "j.txt", content: "cut" } }),
    ).toThrow(LangChainGuardRefusal);

    await (await guard.fetch(`${srv.baseUrl}/responses-complete`, { method: "POST" })).json();
    expect(
      tool.invoke({ type: "tool_call", id: "call_rj1", name: "write_file", args: { path: "rj.txt", content: "ok" } }),
    ).toBe("ok");

    await (await guard.fetch(`${srv.baseUrl}/responses-incomplete`, { method: "POST" })).json();
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_rj2", name: "write_file", args: { path: "rj.txt", content: "cut" } }),
    ).toThrow(LangChainGuardRefusal);

    // Next response HTTP 500 revokes any earlier unconsumed turn authority
    await (await guard.fetch(`${srv.baseUrl}/chat-complete`, { method: "POST" })).json();
    const errorResponse = await guard.fetch(`${srv.baseUrl}/error-500`, { method: "POST" });
    expect(errorResponse.status).toBe(500);
    expect(await errorResponse.json()).toEqual({ error: { message: "server error" } });
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_json_1", name: "write_file", args: { path: "j.txt", content: "ok" } }),
    ).toThrow(expect.objectContaining({ reason: "no_authority" }));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  describe("non-streaming JSON", () => {
    const args = { path: "json.txt", content: "ok" };
    const call = { type: "tool_call", id: "call_json", name: "write_file", args };
    const item = {
      type: "function_call",
      id: "fc_json",
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(args),
      status: "completed",
    };

    it("ignores non-tool output items and accepts a completed Responses payload with error: null", async () => {
      const payload = {
        object: "response",
        status: "completed",
        error: null,
        output: [{ type: "message", role: "assistant" }, item],
      };
      const srv = await startServer((_req, res) => {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(payload));
      });
      const guard = guardChatOpenAI();
      const spy = vi.fn(() => "ok");
      const tool = guard.guardTool(makeWriteTool(spy));

      expect(await (await guard.fetch(srv.baseUrl)).json()).toEqual(payload);
      expect(guard.lastTurnResult()?.decisions).toMatchObject([{ action: "execute", toolCallId: call.id }]);
      expect(tool.invoke(call)).toBe("ok");
      expect(spy).toHaveBeenCalledExactlyOnceWith(args);
    });

    it.each([
      { label: "missing output item identity", fields: { output: [{ ...item, id: "" }] }, reason: "invalid_json_response" },
      { label: "missing call identity", fields: { output: [{ ...item, call_id: undefined, name: undefined, arguments: "" }] }, reason: "no_authority" },
      { label: "incomplete without details", fields: { status: "incomplete" }, reason: "stream_incomplete" },
      { label: "incomplete with an invalid reason", fields: { status: "incomplete", incomplete_details: { reason: 12 } }, reason: "stream_incomplete" },
      { label: "in progress", fields: { status: "in_progress", error: null }, reason: "stream_incomplete" },
      { label: "explicit provider failure", fields: { status: "failed", error: { code: "server_error", message: "failed" } }, reason: "provider_error", providerReason: "server_error" },
      { label: "provider failure without details", fields: { status: "failed" }, reason: "provider_error", providerReason: "response.failed" },
      { label: "completed with a provider error", fields: { error: {} }, reason: "provider_error", providerReason: "response.failed" },
    ])("refuses Responses JSON with $label", async ({ fields, reason, providerReason }) => {
      const payload = { object: "response", status: "completed", output: [item], ...fields };
      const guard = guardChatOpenAI({ fetch: async () => Response.json(payload) });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      const response = await guard.fetch("https://example.invalid/v1/responses");
      expect(await response.json()).toEqual(JSON.parse(JSON.stringify(payload)));
      expect(guard.lastTurnResult()).toMatchObject({ protocol: "json" });
      if (providerReason) {
        expect(guard.lastTurnResult()?.decisions).toMatchObject([{ evidence: { providerReason } }]);
      }
      expect(() => tool.invoke(call)).toThrow(expect.objectContaining({ reason }));
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      { label: "invalid UTF-8", body: new Uint8Array([0xff]), reason: "invalid_utf8" },
      { label: "invalid JSON", body: '{"choices":', reason: "invalid_json_response" },
      { label: "a non-object payload", body: "[]", reason: "invalid_json_response" },
      { label: "a malformed choice", body: '{"choices":[null]}', reason: "invalid_json_response" },
      { label: "no body", body: null, reason: "invalid_json_response" },
      { label: "an in-band provider error", body: '{"error":{"message":"upstream failure"}}', reason: "no_authority" },
      { label: "an unrecognized object", body: '{"ok":true,"error":null}', reason: "no_authority" },
    ])("refuses JSON responses with $label", async ({ body, reason }) => {
      const guard = guardChatOpenAI({
        fetch: async () => new Response(body, { headers: { "content-type": "application/json" } }),
      });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      const response = await guard.fetch("https://example.invalid/v1/chat/completions");
      const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body ?? new Uint8Array();
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
      expect(guard.lastTurnResult()?.framingError).toBe(reason === "no_authority" ? undefined : reason);
      expect(() => tool.invoke(call)).toThrow(expect.objectContaining({ reason }));
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      { label: "no message", choice: { finish_reason: "stop" } },
      { label: "an empty tool list", choice: { message: { tool_calls: [] }, finish_reason: "stop" } },
      { label: "a malformed tool entry", choice: { message: { tool_calls: ["write_file"] }, finish_reason: "tool_calls" } },
      { label: "a missing function", choice: { message: { tool_calls: [{ index: 0 }] }, finish_reason: "tool_calls" } },
      { label: "invalid function fields", choice: { message: { tool_calls: [{ id: call.id, function: { name: 1, arguments: args } }] }, finish_reason: "tool_calls" } },
      { label: "no finish reason", choice: { message: { tool_calls: [{ id: call.id, function: { name: call.name, arguments: item.arguments } }] } } },
      { label: "an invalid legacy function", choice: { message: { function_call: { name: 1, arguments: args } }, finish_reason: "function_call" } },
    ])("does not authorize Chat Completions JSON with $label", async ({ choice }) => {
      const payload = { choices: [{ index: 0, ...choice }] };
      const guard = guardChatOpenAI({ fetch: async () => Response.json(payload) });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      expect(await (await guard.fetch("https://example.invalid/v1/chat/completions")).json()).toEqual(payload);
      expect(guard.lastTurnResult()?.decisions.map(({ action }) => action)).not.toContain("execute");
      expect(() => tool.invoke(call)).toThrow(LangChainGuardRefusal);
      expect(spy).not.toHaveBeenCalled();
    });

    it("observes a legacy function_call without granting authority to an SDK-supplied ID", async () => {
      const payload = {
        choices: [{
          index: 0,
          message: { function_call: { name: call.name, arguments: item.arguments } },
          finish_reason: "function_call",
        }],
      };
      const guard = guardChatOpenAI({ fetch: async () => Response.json(payload) });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      await (await guard.fetch("https://example.invalid/v1/chat/completions")).json();
      expect(guard.lastTurnResult()?.decisions).toMatchObject([{
        name: call.name,
        evidence: { structurallyComplete: true },
      }]);
      expect(guard.lastTurnResult()?.decisions[0]?.toolCallId).toBeUndefined();
      expect(() => tool.invoke(call)).toThrow(expect.objectContaining({ reason: "no_authority" }));
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([true, false])("caps oversized JSON across chunks (limit reached exactly: %s)", async (atLimit) => {
      const cancel = vi.fn();
      const encoder = new TextEncoder();
      const upstream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(atLimit ? '{"ok":12' : '{"ok":'));
          controller.enqueue(encoder.encode(atLimit ? "34}" : "1234}"));
        },
        cancel,
      });
      const guard = guardChatOpenAI({
        maxEventBytes: 8,
        fetch: async () => new Response(upstream, {
          headers: { "content-type": "application/json", "content-length": "11" },
        }),
      });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      const response = await guard.fetch("https://example.invalid/v1/chat/completions");
      expect(response.headers.has("content-length")).toBe(false);
      expect(await response.text()).toBe('{"ok":12');
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(guard.lastTurnResult()).toMatchObject({ protocol: "json", framingError: "resource_limit" });
      expect(() => tool.invoke(call)).toThrow(expect.objectContaining({ reason: "resource_limit" }));
      expect(spy).not.toHaveBeenCalled();
    });

    it("records a failed JSON body read even when the turn observer throws", async () => {
      const failure = new Error("body read failed");
      const onTurnResult = vi.fn(() => { throw new Error("observer failed"); });
      const guard = guardChatOpenAI({
        fetch: async () => new Response(new ReadableStream({
          start(controller) {
            controller.error(failure);
          },
        }), { headers: { "content-type": "application/json" } }),
        onTurnResult,
      });
      const spy = vi.fn();
      const tool = guard.guardTool(makeWriteTool(spy));

      await expect(guard.fetch("https://example.invalid/v1/chat/completions")).rejects.toBe(failure);
      expect(guard.lastTurnResult()).toMatchObject({ protocol: "json", framingError: "transport_error" });
      expect(onTurnResult).toHaveBeenCalledExactlyOnceWith(guard.lastTurnResult());
      expect(() => tool.invoke(call)).toThrow(expect.objectContaining({ reason: "no_authority" }));
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it("reports a missing SSE body and revokes a previously authorized call", async () => {
    const args = { path: "missing.txt", content: "ok" };
    const frames = makeChatToolCallFrames({
      id: "call_missing",
      name: "write_file",
      argChunks: [JSON.stringify(args)],
      finishReason: "tool_calls",
    });
    const srv = await startServer((req, res) => {
      res.writeHead(req.url === "/empty" ? 204 : 200, { "content-type": "text/event-stream" });
      res.end(req.url === "/empty" ? undefined : frames.join(""));
    });
    const onTurnResult = vi.fn();
    const guard = guardChatOpenAI({ onTurnResult });
    const spy = vi.fn();
    const tool = guard.guardTool(makeWriteTool(spy));

    await (await guard.fetch(srv.baseUrl)).text();
    expect(guard.lastTurnResult()?.decisions).toMatchObject([{ action: "execute" }]);

    const empty = await guard.fetch(`${srv.baseUrl}/empty`);
    expect(empty.status).toBe(204);
    expect(empty.body).toBeNull();
    expect(guard.lastTurnResult()).toMatchObject({ protocol: "sse", decisions: [], framingError: "missing_body" });
    expect(onTurnResult).toHaveBeenCalledTimes(2);
    expect(onTurnResult).toHaveBeenLastCalledWith(guard.lastTurnResult());
    expect(() => tool.invoke({ type: "tool_call", id: "call_missing", args })).toThrow(
      expect.objectContaining({ reason: "missing_body" }),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    { framingError: "invalid_sse_json", tail: [chatSseFrame('{"choices":'), chatSseFrame("[DONE]")] },
    { framingError: "invalid_sse_event", tail: [chatSseFrame([]), chatSseFrame("[DONE]")] },
    { framingError: "invalid_utf8", tail: [new Uint8Array([0xff]), chatSseFrame("[DONE]")] },
    { framingError: "invalid_utf8", tail: [new Uint8Array([0xe2, 0x82])] },
    { framingError: "resource_limit", tail: [chatSseFrame({ text: "x".repeat(512) }), chatSseFrame("[DONE]")] },
  ])("blocks an otherwise complete SSE call on $framingError (tail %#)", async ({ framingError, tail }) => {
    const args = { path: "frame.txt", content: "ok" };
    const frames = makeChatToolCallFrames({
      id: "call_frame",
      name: "write_file",
      argChunks: [JSON.stringify(args)],
      finishReason: "tool_calls",
      includeDone: false,
    });
    const encoder = new TextEncoder();
    const chunks = [
      ...frames,
      ...tail,
    ].map((chunk) => typeof chunk === "string" ? encoder.encode(chunk) : chunk);
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const onTurnResult = vi.fn();
    const guard = guardChatOpenAI({
      maxEventBytes: 512,
      fetch: async () => new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
      onTurnResult,
    });
    const spy = vi.fn();
    const tool = guard.guardTool(makeWriteTool(spy));

    const response = await guard.fetch("https://example.invalid/v1/chat/completions");
    const forwarded = new Uint8Array(await response.arrayBuffer());
    expect(Buffer.from(forwarded)).toEqual(Buffer.concat(chunks));
    expect(guard.lastTurnResult()).toMatchObject({ protocol: "sse", framingError });
    expect(onTurnResult).toHaveBeenCalledExactlyOnceWith(guard.lastTurnResult());
    expect(() => tool.invoke({ type: "tool_call", id: "call_frame", args })).toThrow(
      expect.objectContaining({ reason: framingError }),
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("accepts SSE comments, blank data lines, and multiline JSON using CR delimiters", async () => {
    const args = { path: "frame.txt", content: "ok" };
    const frames = makeChatToolCallFrames({
      id: "call_multiline",
      name: "write_file",
      argChunks: [JSON.stringify(args)],
      finishReason: "tool_calls",
    }).join("");
    const wire = (": keep-alive\n\n" + frames.replace('data: {"id"', 'data\ndata:{\ndata: "id"'))
      .replaceAll("\n", "\r");
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.end(wire);
    });
    const guard = guardChatOpenAI();
    const spy = vi.fn(() => "ok");
    const tool = guard.guardTool(makeWriteTool(spy));

    expect(await (await guard.fetch(srv.baseUrl)).text()).toBe(wire);
    expect(tool.invoke({ type: "tool_call", id: "call_multiline", args })).toBe("ok");
    expect(spy).toHaveBeenCalledExactlyOnceWith(args);
  });

  it.each(["sse", "json"])("keeps the newer turn authoritative when an older %s response finishes late", async (protocol) => {
    const args = { path: "current.txt", content: "ok" };
    const frames = (id: string) => makeChatToolCallFrames({
      id,
      name: "write_file",
      argChunks: [JSON.stringify(args)],
      finishReason: "tool_calls",
    }).join("");
    const sseResponse = (id: string) => new Response(frames(id), {
      headers: { "content-type": "text/event-stream" },
    });
    let resolveOlder!: (response: Response) => void;
    const older = new Promise<Response>((resolve) => {
      resolveOlder = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockReturnValueOnce(older)
      .mockResolvedValueOnce(sseResponse("call_current"));
    const onTurnResult = vi.fn();
    const guard = guardChatOpenAI({ fetch, onTurnResult });
    const spy = vi.fn(() => "ok");
    const tool = guard.guardTool(makeWriteTool(spy));
    const endpoint = "https://example.invalid/v1/chat/completions";

    const pending = guard.fetch(endpoint);
    await (await guard.fetch(endpoint)).text();
    const current = guard.lastTurnResult();
    expect(current?.decisions).toMatchObject([{ action: "execute", toolCallId: "call_current" }]);

    resolveOlder(protocol === "sse" ? sseResponse("call_old") : Response.json({
      choices: [{
        index: 0,
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{ id: "call_old", type: "function", function: { name: "write_file", arguments: JSON.stringify(args) } }],
        },
      }],
    }));
    await (await pending).text();
    expect(onTurnResult).toHaveBeenCalledTimes(2);
    expect(onTurnResult).toHaveBeenLastCalledWith(expect.objectContaining({
      protocol,
      decisions: [expect.objectContaining({ action: "execute", toolCallId: "call_old" })],
    }));
    expect(guard.lastTurnResult()).toBe(current);
    expect(() => tool.invoke({ type: "tool_call", id: "call_old", args })).toThrow(
      expect.objectContaining({ reason: "no_authority" }),
    );
    expect(tool.invoke(args, { toolCall: { id: "call_current", name: "write_file" } })).toBe("ok");
    expect(spy).toHaveBeenCalledExactlyOnceWith(args);
  });

  it("enforces one-shot authority, projection equality, tool-name match, parallel calls, and multi-turn revocation", async () => {
    const base = { id: "c", object: "chat.completion.chunk", created: 1, model: "m" };
    const srv = await startServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      if (req.url === "/parallel") {
        res.write(
          chatSseFrame({
            ...base,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    { index: 0, id: "call_p1", type: "function", function: { name: "write_file", arguments: '{"path":"a.txt","content":"A"}' } },
                    { index: 1, id: "call_p2", type: "function", function: { name: "write_file", arguments: '{"path":"b.txt","content":"B"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        );
        res.end(chatSseFrame("[DONE]"));
        return;
      }
      res.end(
        makeChatToolCallFrames({
          id: "call_single",
          name: "write_file",
          argChunks: ['{"path":"a.txt","content":"A"}'],
          finishReason: "tool_calls",
        }).join(""),
      );
    });

    const spy = vi.fn(() => "ok");
    const guard = guardChatOpenAI();
    const tool = guard.guardTool(makeWriteTool(spy));

    // Parallel calls: each executes once independently
    await (await guard.fetch(`${srv.baseUrl}/parallel`, { method: "POST" })).text();
    expect(
      tool.invoke({ type: "tool_call", id: "call_p1", name: "write_file", args: { path: "a.txt", content: "A" } }),
    ).toBe("ok");
    expect(
      tool.invoke({ type: "tool_call", id: "call_p2", name: "write_file", args: { path: "b.txt", content: "B" } }),
    ).toBe("ok");

    // Reusing authority throws authority_reused
    let reuseError: unknown;
    try {
      tool.invoke({ type: "tool_call", id: "call_p1", name: "write_file", args: { path: "a.txt", content: "A" } });
    } catch (error) {
      reuseError = error;
    }
    expect(reuseError).toBeInstanceOf(LangChainGuardRefusal);
    expect((reuseError as LangChainGuardRefusal).reason).toBe("authority_reused");

    // Projection mismatch and tool name mismatch
    await (await guard.fetch(`${srv.baseUrl}/single`, { method: "POST" })).text();
    let mismatchError: unknown;
    try {
      tool.invoke({ type: "tool_call", id: "call_single", name: "write_file", args: { path: "a.txt", content: "TAMPERED" } });
    } catch (error) {
      mismatchError = error;
    }
    expect(mismatchError).toBeInstanceOf(LangChainGuardRefusal);
    expect((mismatchError as LangChainGuardRefusal).reason).toBe("projection_mismatch");

    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_single", name: "other_tool", args: { path: "a.txt", content: "A" } }),
    ).toThrow(LangChainGuardRefusal);

    // guard.take() consumes directly as well
    const taken = guard.take(
      { path: "a.txt", content: "A" },
      { toolCall: { id: "call_single", name: "write_file" } },
    );
    expect(taken).toEqual({ path: "a.txt", content: "A" });

    // Explicit revoke() clears unused authority
    await (await guard.fetch(`${srv.baseUrl}/single`, { method: "POST" })).text();
    guard.revoke();
    expect(() =>
      tool.invoke({ type: "tool_call", id: "call_single", name: "write_file", args: { path: "a.txt", content: "A" } }),
    ).toThrow(LangChainGuardRefusal);
  });

  it("auto-validates Zod v4, Zod v3-like, and plain JSON Schema tool definitions", async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      // `content` is a number instead of string -> structurally complete JSON, but fails schema
      res.end(
        makeChatToolCallFrames({
          id: "call_bad_schema",
          name: "write_file",
          argChunks: ['{"path":"a.txt","content":123}'],
          finishReason: "tool_calls",
        }).join(""),
      );
    });

    const schemas: unknown[] = [
      z.object({ path: z.string(), content: z.string() }),
      {
        safeParse: (value: unknown) =>
          value && typeof value === "object" && typeof (value as { content?: unknown }).content === "string"
            ? { success: true, data: value }
            : { success: false, error: { issues: [{ path: ["content"], message: "Expected string" }] } },
      },
      {
        type: "object",
        required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    ];

    for (const schema of schemas) {
      const spy = vi.fn();
      const guard = guardChatOpenAI();
      const tool = guard.guardTool(makeWriteTool(spy, schema));

      await (await guard.fetch(`${srv.baseUrl}/v1/chat/completions`, { method: "POST" })).text();

      let caught: unknown;
      try {
        tool.invoke({
          type: "tool_call",
          id: "call_bad_schema",
          name: "write_file",
          args: { path: "a.txt", content: 123 },
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LangChainGuardRefusal);
      expect((caught as LangChainGuardRefusal).reason).toBe("schema_invalid");
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("keeps tool identities and one-shot authority separate across guardTools()", async () => {
    const args = { path: "shared.txt", content: "ok" };
    const calls = [
      { index: 0, id: "call_write", name: "write_file" },
      { index: 1, id: "call_append", name: "append_file" },
    ];
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(chatSseFrame({
        choices: [{
          index: 0,
          delta: {
            tool_calls: calls.map(({ index, id, name }) => ({
              index, id, type: "function", function: { name, arguments: JSON.stringify(args) },
            })),
          },
          finish_reason: "tool_calls",
        }],
      }) + chatSseFrame("[DONE]"));
    });
    const writeFile = vi.fn(() => "written");
    const appendFile = vi.fn(() => "appended");
    const rawWrite = makeWriteTool(writeFile);
    const rawAppend = { ...makeWriteTool(appendFile), name: "append_file", schema: null };
    const validate = vi.fn(() => ({ valid: true as const }));
    const guard = guardChatOpenAI({ validators: { append_file: { validate } } });
    const [write, append] = guard.guardTools([rawWrite, rawAppend] as const);
    const writeCall = { type: "tool_call", id: "call_write", name: "write_file", args };

    expect(guard.guardTool(rawWrite)).toBe(write);
    expect(() => guard.guardTool(makeWriteTool(vi.fn()))).toThrow(/duplicate tool name/);
    await (await guard.fetch(srv.baseUrl)).text();
    expect(validate).toHaveBeenCalledExactlyOnceWith(args);
    expect(() => write.invoke({ ...writeCall, id: "unknown" })).toThrow(
      expect.objectContaining({ reason: "no_authority", toolCallId: "unknown" }),
    );
    expect(() => write.invoke({ ...writeCall, id: "call_append" })).toThrow(
      expect.objectContaining({ reason: "no_authority", toolCallId: "call_append" }),
    );
    expect(() => write.invoke({ ...writeCall, name: "append_file" })).toThrow(
      expect.objectContaining({ reason: "tool_name_mismatch", toolName: "append_file" }),
    );
    expect(() => write.invoke(args)).toThrow(expect.objectContaining({ reason: "no_authority" }));
    expect(() => write.invoke({ type: "tool_call", args })).toThrow(
      expect.objectContaining({ reason: "no_authority" }),
    );
    expect(() => write.invoke({ ...writeCall, id: "" })).toThrow(expect.objectContaining({ reason: "no_authority" }));
    expect(() => guard.take(args, { toolCallId: writeCall.id })).toThrow(
      expect.objectContaining({ reason: "no_authority" }),
    );
    expect(() => guard.take(args)).toThrow(expect.objectContaining({ reason: "no_authority" }));
    expect(writeFile).not.toHaveBeenCalled();
    expect(appendFile).not.toHaveBeenCalled();

    expect(write.invoke({ type: "tool_call", args }, { toolCall: { id: writeCall.id, name: writeCall.name } }))
      .toBe("written");
    expect(() => write.invoke(writeCall)).toThrow(expect.objectContaining({ reason: "authority_reused" }));
    expect(append.invoke({ type: "tool_call", args }, { toolCallId: "call_append" })).toBe("appended");
    expect(writeFile).toHaveBeenCalledExactlyOnceWith(args);
    expect(appendFile).toHaveBeenCalledExactlyOnceWith(args);
  });

  it("preserves default configuration and forwards requests through its custom fetch", async () => {
    const upstream = new Response("plain text");
    upstream.headers.delete("content-type");
    const fetch = vi.fn(async () => upstream);
    const observer = vi.fn();
    const guard = guardChatOpenAI({
      configuration: { baseURL: "https://example.invalid/v1", fetch, headers: { "x-test": "default" } },
      onTurnResult: observer,
    });
    const merged = guard.chatOptions({ model: "test-model" });
    expect(merged).toEqual({ model: "test-model", configuration: guard.configuration });
    expect(merged.configuration).toMatchObject({
      baseURL: "https://example.invalid/v1",
      headers: { "x-test": "default" },
      fetch: guard.fetch,
    });
    expect(guard.chatOptions({ configuration: guard.configuration }).configuration.fetch).toBe(guard.fetch);
    const request = new Request("https://example.invalid/v1/chat/completions", { method: "POST", body: "{}" });
    const init = { headers: { "x-test": "request" } };

    const response = await merged.configuration.fetch(request, init);
    expect(response).toBe(upstream);
    expect(await response.text()).toBe("plain text");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(request, init);
    expect(observer).not.toHaveBeenCalled();
    expect(guard.lastTurnResult()).toBeUndefined();
  });

  it("preserves tool class identity, getters, call() chaining, and chatOptions custom fetch", async () => {
    class FakeStructuredTool implements LangChainToolLike {
      readonly name = "write_file";
      readonly description = "Write file";
      readonly schema = z.object({ path: z.string(), content: z.string() });
      readonly invoked: unknown[] = [];

      get lc_namespace(): string[] {
        return ["langchain", "tools"];
      }

      invoke(input: unknown, config?: { toolCall?: { id?: string; name?: string } }): unknown {
        const args =
          input && typeof input === "object" && (input as { type?: unknown }).type === "tool_call"
            ? (input as { args: unknown }).args
            : input;
        // Mirrors StructuredTool.prototype.invoke calling `this.call(...)` internally.
        return this.call(args, config);
      }

      call(arg: unknown, _configArg?: unknown): unknown {
        this.invoked.push(arg);
        return `called:${JSON.stringify(arg)}`;
      }

      getInvocationCount(): number {
        return this.invoked.length;
      }
    }

    const frames = makeChatToolCallFrames({
      id: "call_cls",
      name: "write_file",
      argChunks: ['{"path":"x.txt","content":"y"}'],
      finishReason: "tool_calls",
    });

    const customFetch = vi.fn(
      async () =>
        new Response(frames.join(""), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        }),
    );

    const guard = guardChatOpenAI();
    const rawTool = new FakeStructuredTool();
    const wrappedTool = guard.guardTool(rawTool);

    expect(wrappedTool).toBeInstanceOf(FakeStructuredTool);
    expect((wrappedTool as unknown as FakeStructuredTool).lc_namespace).toEqual(["langchain", "tools"]);
    expect(guard.guardTool(wrappedTool)).toBe(wrappedTool);

    const merged = guard.chatOptions({
      model: "gpt-4o",
      streaming: true,
      configuration: { baseURL: "https://example.invalid/v1", fetch: customFetch },
    });
    expect(merged.configuration.baseURL).toBe("https://example.invalid/v1");
    expect(merged.configuration.fetch).not.toBe(customFetch);

    await (await merged.configuration.fetch("https://example.invalid/v1/chat/completions", { method: "POST" })).text();
    expect(customFetch).toHaveBeenCalledTimes(1);

    // Calling invoke() must NOT double-consume via internal `this.call(...)`
    const result = wrappedTool.invoke({
      type: "tool_call",
      id: "call_cls",
      name: "write_file",
      args: { path: "x.txt", content: "y" },
    });
    expect(result).toBe('called:{"path":"x.txt","content":"y"}');
    expect(rawTool.invoked).toEqual([{ path: "x.txt", content: "y" }]);

    const args = { path: "x.txt", content: "y" };
    const endpoint = "https://example.invalid/v1/chat/completions";
    await (await merged.configuration.fetch(endpoint)).text();
    expect(() => wrappedTool.call(args, { toolCall: { id: "call_cls", name: "other_tool" } })).toThrow(
      expect.objectContaining({ reason: "tool_name_mismatch", toolName: "other_tool" }),
    );
    expect(() => wrappedTool.call(args, "legacy config")).toThrow(expect.objectContaining({ reason: "no_authority" }));
    expect(wrappedTool.call(args, { toolCallId: "call_cls" })).toBe(`called:${JSON.stringify(args)}`);

    await (await merged.configuration.fetch(endpoint)).text();
    const call = { type: "tool_call", id: "call_cls", name: "write_file", args };
    expect(wrappedTool.call(call)).toBe(`called:${JSON.stringify(call)}`);
    const countInvocations = wrappedTool.getInvocationCount;
    expect(countInvocations()).toBe(3);
  });
});
