// Offline reproduction of the LangGraph.js streaming tool-call cutoff bug
// (from agent-faultbench's `cutoff` suite) and its 2-line fix using
// `prefix-safe-json/langchain`.
//
// In a real LangChain / LangGraph.js app:
//
//   import { guardChatOpenAI } from "prefix-safe-json/langchain";
//
//   const guard = guardChatOpenAI();
//   const llm = new ChatOpenAI({ model: "gpt-4o", streaming: true, configuration: guard.configuration });
//   const agent = createReactAgent({ llm, tools: guard.guardTools([writeFile]) });
//
// This example uses only Node built-ins + the local build in `dist/` (no API
// key, no network access, no external LangChain install required).
//
// Run: node examples/langchain-cutoff-guard.mjs

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { guardChatOpenAI, LangChainGuardRefusal } from "../dist/langchain.js";

const LINES = Array.from(
  { length: 40 },
  (_, index) => `line ${String(index + 1).padStart(2, "0")}: the quick brown fox jumps over the lazy dog`,
);
const FULL_CONTENT = `${LINES.join("\n")}\n`;
const FULL_BYTES = Buffer.byteLength(FULL_CONTENT, "utf8"); // 2,120 bytes
const FULL_ARGS = JSON.stringify({ path: "report.txt", content: FULL_CONTENT });
const CUT_MARKER = "line 17: the quick";
const CUT_ARGS = FULL_ARGS.slice(0, FULL_ARGS.indexOf(CUT_MARKER) + CUT_MARKER.length);

function chunkString(text, size = 24) {
  const parts = [];
  for (let offset = 0; offset < text.length; offset += size) {
    parts.push(text.slice(offset, offset + size));
  }
  return parts;
}

function startLocalOpenAIServer() {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const urlPath = req.url ?? "/complete/v1/chat/completions";
      const mode = urlPath.replace(/^\/+/, "").split("/")[0] ?? "complete";
      const rawBody = Buffer.concat(chunks).toString("utf8");
      const body = rawBody ? JSON.parse(rawBody) : {};
      const hasToolResult = Array.isArray(body.messages) && body.messages.some((m) => m?.role === "tool");

      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });

      const base = { id: "chatcmpl-local", object: "chat.completion.chunk", created: 1, model: "local-mock" };

      if (hasToolResult) {
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Done." }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      const argsToSend = mode === "complete" ? FULL_ARGS : CUT_ARGS;
      res.write(
        `data: ${JSON.stringify({
          ...base,
          choices: [{
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: [{ index: 0, id: "call_bench_1", type: "function", function: { name: "write_file", arguments: "" } }],
            },
            finish_reason: null,
          }],
        })}\n\n`,
      );

      for (const piece of chunkString(argsToSend)) {
        res.write(
          `data: ${JSON.stringify({
            ...base,
            choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: piece } }] }, finish_reason: null }],
          })}\n\n`,
        );
      }

      if (mode === "complete" || mode === "length") {
        res.write(
          `data: ${JSON.stringify({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: mode === "complete" ? "tool_calls" : "length" }],
          })}\n\n`,
        );
        res.write("data: [DONE]\n\n");
      }
      // In `drop` mode, the HTTP body ends cleanly with no `finish_reason` and no `[DONE]`.
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Expected TCP server address"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

// Mirrors LangChain's streaming partial-JSON repair on a cut string/object so
// an incomplete tool-call argument string still yields a parseable object.
function repairPartialJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    let repaired = raw;
    let inString = false;
    let escaped = false;
    for (const ch of raw) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = !inString;
      }
    }
    if (inString) repaired += '"';
    if (!repaired.trimEnd().endsWith("}")) repaired += "}";
    return JSON.parse(repaired);
  }
}

async function runStreamingAgentTurn({ fetchFn, baseUrl, mode, writeFileTool }) {
  const response = await fetchFn(`${baseUrl}/${mode}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "local-mock",
      stream: true,
      messages: [{ role: "user", content: "Write the 40-line report to report.txt." }],
    }),
  });

  const text = await response.text();
  const events = text
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n"),
    )
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));

  let id = "";
  let name = "";
  let argsBuffer = "";
  for (const ev of events) {
    const tc = ev.choices?.[0]?.delta?.tool_calls?.[0];
    if (!tc) continue;
    if (tc.id) id = tc.id;
    if (tc.function?.name) name += tc.function.name;
    if (tc.function?.arguments) argsBuffer += tc.function.arguments;
  }

  const repairedArgs = repairPartialJson(argsBuffer);
  const toolCall = { type: "tool_call", id, name, args: repairedArgs };

  let toolOutcome;
  try {
    const result = await writeFileTool.invoke(toolCall, { toolCall });
    toolOutcome = { status: "success", message: String(result) };
  } catch (error) {
    toolOutcome = {
      status: "error",
      errorName: error instanceof Error ? error.name : "Error",
      reason: error instanceof LangChainGuardRefusal ? error.reason : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  // Turn 2: send tool result back to model (mirrors LangGraph ToolNode -> agent loop).
  await fetchFn(`${baseUrl}/${mode}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "local-mock",
      stream: true,
      messages: [
        { role: "user", content: "Write the 40-line report to report.txt." },
        { role: "tool", tool_call_id: id, content: toolOutcome.message },
      ],
    }),
  }).then((r) => r.text());

  return toolOutcome;
}

function createDiskWriteTool(workDir) {
  return {
    name: "write_file",
    description: "Write UTF-8 content to a file.",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
    async invoke(input) {
      const args = input && input.type === "tool_call" ? input.args : input;
      writeFileSync(join(workDir, basename(args.path)), args.content, "utf8");
      return `Wrote ${args.content.length} characters to ${basename(args.path)}`;
    },
  };
}

async function runScenario({ label, baseUrl, mode, guarded }) {
  const workDir = mkdtempSync(join(tmpdir(), "psj-langchain-demo-"));
  try {
    const baseTool = createDiskWriteTool(workDir);
    const guard = guarded ? guardChatOpenAI() : undefined;
    const fetchFn = guard ? guard.fetch : globalThis.fetch;
    const writeFileTool = guard ? guard.guardTool(baseTool) : baseTool;

    const toolOutcome = await runStreamingAgentTurn({ fetchFn, baseUrl, mode, writeFileTool });
    const targetFile = join(workDir, "report.txt");
    const fileWritten = existsSync(targetFile);
    const diskContent = fileWritten ? readFileSync(targetFile, "utf8") : "";
    const diskBytes = fileWritten ? Buffer.byteLength(diskContent, "utf8") : 0;
    const lines = diskContent ? diskContent.split("\n") : [];

    console.log(`\n=== ${label} ===`);
    console.log(`  tool outcome: ${toolOutcome.status} -> ${toolOutcome.message}`);
    console.log(`  file written: ${fileWritten} (${diskBytes} / ${FULL_BYTES} bytes)`);
    if (fileWritten) {
      console.log(`  last line:    ${JSON.stringify(lines[lines.length - 1])}`);
    }
    return { toolOutcome, fileWritten, diskBytes, diskContent };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const server = await startLocalOpenAIServer();
try {
  // 1. Without PSJ guard: half-written file (866 / 2,120 bytes) is written and reported as success.
  const unguarded = await runScenario({
    label: "1. WITHOUT guard (finish_reason='length' cutoff)",
    baseUrl: server.baseUrl,
    mode: "length",
    guarded: false,
  });
  assert.equal(unguarded.fileWritten, true);
  assert.equal(unguarded.diskBytes, 866);
  assert.equal(unguarded.toolOutcome.status, "success");

  // 2. With PSJ guard (`length` cutoff): refused before writeFileSync -> 0 bytes written.
  const guardedLength = await runScenario({
    label: "2. WITH guardChatOpenAI() (finish_reason='length' cutoff)",
    baseUrl: server.baseUrl,
    mode: "length",
    guarded: true,
  });
  assert.equal(guardedLength.fileWritten, false);
  assert.equal(guardedLength.diskBytes, 0);
  assert.equal(guardedLength.toolOutcome.status, "error");
  assert.equal(guardedLength.toolOutcome.errorName, "LangChainGuardRefusal");
  assert.equal(guardedLength.toolOutcome.reason, "truncated");

  // 3. With PSJ guard (`drop` clean EOF): refused before writeFileSync -> 0 bytes written.
  const guardedDrop = await runScenario({
    label: "3. WITH guardChatOpenAI() (dropped SSE stream, no finish_reason)",
    baseUrl: server.baseUrl,
    mode: "drop",
    guarded: true,
  });
  assert.equal(guardedDrop.fileWritten, false);
  assert.equal(guardedDrop.diskBytes, 0);
  assert.equal(guardedDrop.toolOutcome.status, "error");
  assert.equal(guardedDrop.toolOutcome.errorName, "LangChainGuardRefusal");
  assert.equal(guardedDrop.toolOutcome.reason, "truncated");

  // 4. With PSJ guard (`complete` control): full 2,120-byte / 40-line file written.
  const guardedComplete = await runScenario({
    label: "4. WITH guardChatOpenAI() (complete finish_reason='tool_calls' control)",
    baseUrl: server.baseUrl,
    mode: "complete",
    guarded: true,
  });
  assert.equal(guardedComplete.fileWritten, true);
  assert.equal(guardedComplete.diskBytes, FULL_BYTES);
  assert.equal(guardedComplete.toolOutcome.status, "success");

  console.log("\nPASS: unguarded cutoff wrote 866/2120 bytes; guarded length/drop wrote 0 bytes; guarded complete wrote 2120/2120 bytes.");
} finally {
  await server.close();
}
