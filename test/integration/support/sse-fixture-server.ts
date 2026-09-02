// ---------------------------------------------------------------------------
// Minimal, ephemeral local SSE fixture server for P2 (Official SDK Lifecycle
// Proof). Node built-ins only (`node:http`) - no Express/Fastify/MSW/nock/
// EventSource/SSE-parser packages/test-server frameworks, per the explicitly
// approved P2 dependency scope. This exists ONLY to put real bytes on a real
// loopback socket so that the REAL official provider SDK's OWN HTTP/SSE
// parser is what turns them into userland event objects - never to
// hand-construct those objects ourselves.
//
// Every server instance answers EVERY request with the SAME canned
// status/headers/body: one fixture per server, one server per test case. The
// request itself (method, path, headers, body) is never inspected or
// validated - the SDK's own request construction is not under test here,
// only its response parsing.
// ---------------------------------------------------------------------------
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface SseFixture {
  status?: number;
  headers?: Record<string, string>;
  /** Raw bytes written to the response body, in order. */
  chunks: readonly string[];
  /** Delay in ms before writing each chunk (default 0 - same tick). */
  interChunkDelayMs?: number;
  /**
   * When true, the socket is left open (no res.end()) after the last chunk.
   * The caller MUST close() the server to release it. Used only for tests
   * that need to prove what happens right up to a connection close without
   * ever exercising a graceful end-of-body signal.
   */
  leaveOpen?: boolean;
}

export interface RunningFixtureServer {
  readonly baseUrl: string;
  close(): Promise<void>;
}

/** Renders one SSE frame. `data` is JSON-stringified unless already a string
 * (needed for the literal, non-JSON `[DONE]` sentinel). */
export function sseFrame(event: string | null, data: unknown): string {
  const dataStr = typeof data === "string" ? data : JSON.stringify(data);
  const dataLines = dataStr
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
  return (event !== null ? `event: ${event}\n` : "") + dataLines + "\n\n";
}

export async function startSseFixtureServer(fixture: SseFixture): Promise<RunningFixtureServer> {
  const server: Server = createServer((_req, res) => {
    res.writeHead(fixture.status ?? 200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      ...fixture.headers,
    });
    void (async () => {
      for (const chunk of fixture.chunks) {
        if (fixture.interChunkDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, fixture.interChunkDelayMs));
        }
        res.write(chunk);
      }
      if (!fixture.leaveOpen) {
        res.end();
      }
    })();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
