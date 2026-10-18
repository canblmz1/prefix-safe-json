// Run the published-package demo without installing this repository's toolchain.
import { copyFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import console from "node:console";

const demos = {
  guarded: {
    directory: "guarded-chat",
    packages: ["ai", "@ai-sdk/openai-compatible", "psj-ai-sdk", "zod"],
  },
  typed: {
    directory: "typed-agent-loop",
    packages: ["ai", "zod"],
    files: ["demo.mts", "tsconfig.json", "check-readme.mjs"],
  },
  "ai-sdk": { directory: "npm-consumer", packages: ["ai", "zod"], batch: true },
  anthropic: { directory: "anthropic-consumer", packages: ["@anthropic-ai/sdk"] },
  openai: { directory: "openai-consumer", packages: ["openai"] },
  openrouter: { directory: "openrouter-consumer", packages: ["@openrouter/agent", "@openrouter/sdk", "zod"] },
  tanstack: { directory: "tanstack-consumer", packages: ["@tanstack/ai", "@tanstack/ai-openrouter", "@openrouter/sdk", "zod"] },
  langchain: { directory: "langchain-consumer", packages: ["@langchain/openai", "@langchain/core"] },
};
const selected = process.argv[2] ?? "guarded";
if (process.argv.length > 3 || !Object.hasOwn(demos, selected)) {
  console.error("Usage: node scripts/try-npm-demo.mjs [guarded|typed|ai-sdk|anthropic|openai|openrouter|tanstack|langchain]");
  process.exit(1);
}
const demo = demos[selected];

if (Number(process.versions.node.split(".")[0]) < 22) {
  console.error("The consumer demos require Node 22 or newer.");
  process.exit(1);
}

const consumer = await mkdtemp(join(tmpdir(), "psj-demo-"));
console.log(`Installing the published ${selected} demo in ${consumer}`);
for (const file of ["package.json", ...(demo.files ?? ["demo.mjs"]), ...(demo.batch ? ["batch-demo.mjs", "identity-demo.mjs"] : [])]) {
  await copyFile(new URL(`../examples/${demo.directory}/${file}`, import.meta.url), join(consumer, file));
}

// Commands and arguments are fixed. Windows needs its command shell for npm.cmd.
for (const args of [
  ["install", "--engine-strict", "--no-audit", "--no-fund"],
  ["ls", "prefix-safe-json", ...demo.packages],
  ["start"],
  ...(demo.batch ? [["run", "batch"]] : []),
  ...(demo.batch ? [["run", "identity"]] : []),
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
console.log("Try PSJ in your own project: https://github.com/canblmz1/prefix-safe-json/blob/main/docs/TRY_IN_YOUR_PROJECT.md");
