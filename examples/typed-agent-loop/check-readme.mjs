import { readFileSync, writeFileSync } from "node:fs";

// Compile the exact first-use snippet shipped in the installed tarball.
const readme = readFileSync(new URL("../README.md", import.meta.resolve("prefix-safe-json")), "utf8");
const block = readme.split("## Safe execution example")[1]?.match(/```javascript\r?\n([\s\S]*?)\r?\n```/)?.[1];
if (!block) throw new Error("Installed package README has no safe execution example");
writeFileSync(new URL("readme-check.mts", import.meta.url),
  'declare const model: import("ai").LanguageModel;\ndeclare const prompt: string;\n' + block);
