import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function packageVersion(name: string): string | null {
  try {
    let directory = dirname(require.resolve(name));
    for (let count = 0; count < 12; count++) {
      try {
        const data = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { name?: string; version?: string };
        if (data.name === name && typeof data.version === "string") return data.version;
      } catch { /* The next parent can contain the package manifest. */ }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  } catch { /* A missing peer is reported without importing it. */ }
  return null;
}

export function versions(): Record<string, string | null> {
  return {
    runner: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
    node: process.versions.node,
    ai: packageVersion("ai"),
    provider: packageVersion("@ai-sdk/openai-compatible"),
    psj: packageVersion("prefix-safe-json"),
  };
}

export function doctor() {
  const installed = versions();
  const atLeast = (version: string | null | undefined, major: number, minor: number, patch: number) => {
    if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) return false;
    const [foundMajor = -1, foundMinor = -1, foundPatch = -1] = version.split(".").map(Number);
    return foundMajor === major && (foundMinor > minor || (foundMinor === minor && foundPatch >= patch));
  };
  const ready = Number(process.versions.node.split(".")[0]) >= 22 && atLeast(installed.ai, 7, 0, 77) &&
    atLeast(installed.provider, 3, 0, 0) && atLeast(installed.psj, 0, 6, 0) && installed.psj?.startsWith("0.6.") === true;
  return { formatVersion: 1, ready, mode: "offline-fixtures", auth: "not-required", versions: installed };
}
