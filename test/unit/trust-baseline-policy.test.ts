import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("trust baseline policy", () => {
  it("keeps private vulnerability reporting instructions explicit", () => {
    const security = read("SECURITY.md");
    expect(security).toContain("/security/advisories/new");
    expect(security).toMatch(/execution-integrity bypasses/i);
    expect(security).toMatch(/Do not open a public issue containing exploit details/i);
  });

  it("keeps dual-license metadata machine-readable without changing legal choice", () => {
    const manifest = JSON.parse(read("package.json"));
    expect(manifest.license).toBe("MIT OR Apache-2.0");
    expect(read("LICENSE")).toContain("SPDX-License-Identifier: MIT OR Apache-2.0");
  });

  it("keeps production SBOM generation, verification, retention, and release attachment wired", () => {
    const ci = read(".github/workflows/ci.yml");
    const publish = read(".github/workflows/publish.yml");
    const manifest = JSON.parse(read("package.json"));

    expect(manifest.scripts["sbom:generate"]).toBe("node scripts/generate-sbom.mjs");
    expect(manifest.scripts["sbom:verify"]).toBe("node scripts/verify-sbom.mjs");
    for (const workflow of [ci, publish]) {
      expect(workflow).toContain("pnpm run sbom:generate");
      expect(workflow).toContain("pnpm run sbom:verify");
      expect(workflow).toContain("actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02");
    }
    expect(publish).toContain("environment: npm-publish");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("steps.sbom.outputs.path");
  });
});
