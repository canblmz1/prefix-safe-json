// Run the published-package demo without installing this repository's toolchain.
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("The AI SDK v7 demo requires Node 22 or newer.");
  process.exit(1);
}

const consumer = await mkdtemp(join(tmpdir(), "psj-demo-"));
console.log(`Installing the published demo in ${consumer}`);
for (const file of ["package.json", "demo.mjs"]) {
  await copyFile(new URL(`../examples/npm-consumer/${file}`, import.meta.url), join(consumer, file));
}

// Commands and arguments are fixed. Windows needs its command shell for npm.cmd.
for (const args of [
  ["install", "--engine-strict", "--no-audit", "--no-fund"],
  ["ls", "prefix-safe-json", "ai", "zod"],
  ["start"],
]) {
  const code = await new Promise((resolve, reject) => {
    const child = spawn("npm", args, {
      cwd: consumer,
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    console.error(`npm ${args.join(" ")} failed. The directory is retained at ${consumer}`);
    process.exit(code);
  }
}
console.log(`Demo passed. You can edit and rerun it in ${consumer}`);
console.log("To try PSJ in your own project, follow docs/TRY_IN_YOUR_PROJECT.md.");
