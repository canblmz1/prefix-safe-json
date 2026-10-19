#!/usr/bin/env node
import { parseArgs } from "node:util";
import { replayRecording } from "./recording.js";

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    json: { type: "boolean", default: false }, expect: { type: "string" }, help: { type: "boolean", short: "h" },
  } });
  if (values.help || positionals.length === 0) {
    process.stdout.write("Usage: psj-chat replay recording.json [--expect allowed|refused] [--json]\nOffline wire-policy replay; no SDK, application validators, tools or network.\nExit: 0 report/matching expectation; 1 mismatch; 2 input error.\n");
    return;
  }
  if (positionals[0] !== "replay" || positionals.length !== 2 || (values.expect !== undefined && !["allowed", "refused"].includes(values.expect))) throw new Error("Invalid command.");
  const report = await replayRecording(positionals[1]!);
  process.stdout.write(values.json ? JSON.stringify(report) + "\n" : `${report.replayed.status}: ${report.replayed.reason ?? `${report.replayed.toolCalls} eligible calls`} (wire policy only)\n`);
  if (values.expect && report.replayed.status !== values.expect) process.exitCode = 1;
}
main().catch(() => {
  // Avoid dumping paths, raw provider messages or JSON fragments on failure.
  const message = "Could not replay recording. Check the manifest, size limits and original response hash.";
  process.stderr.write(process.argv.includes("--json") ? JSON.stringify({ formatVersion: 1, status: "error", error: { code: "E_RECORDING", message } }) + "\n" : message + "\n");
  process.exitCode = 2;
});
