import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import process from "node:process";

const routes = new Map([
  ["/", ["index.html", "text/html;charset=utf-8"]],
  ["/index.html", ["index.html", "text/html;charset=utf-8"]],
  ["/style.css", ["style.css", "text/css;charset=utf-8"]],
  ["/app.mjs", ["app.mjs", "text/javascript;charset=utf-8"]],
  ["/model.mjs", ["model.mjs", "text/javascript;charset=utf-8"]],
]);
const port = Number(process.argv[2] ?? "4317");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Supply a port between 1 and 65535.");
const server = createServer(async (request, response) => {
  const route = routes.get((request.url ?? "").split("?")[0]);
  if (!route || !["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(404).end("Not found"); return; }
  try {
    const body = await readFile(new URL(route[0], import.meta.url));
    response.writeHead(200, {
      "content-type": route[1], "cache-control": "no-store", "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch { response.writeHead(500).end("Could not read the prototype assets."); }
});
server.listen(port, "127.0.0.1", () => { process.stdout.write(`Devam: http://127.0.0.1:${port}\n`); });
