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

  it("requires npm Trusted Publishing for releases, with no legacy token fallback in the publish step", () => {
    const publish = read(".github/workflows/publish.yml");

    // The publish job itself: gated behind every existing release gate,
    // the protected environment, and job-scoped OIDC - not the top-level
    // workflow permissions block, which stays read-only.
    expect(publish).toMatch(
      /publish:\s*\n\s*needs:\s*\[release-intent,\s*test-matrix,\s*coverage,\s*mutation-test,\s*release-fuzz\]/,
    );
    expect(publish).toContain("environment: npm-publish");
    expect(publish).toContain("id-token: write");
    expect(publish).toContain("contents: write");

    // The actual "Publish to npm" step's own text block (from its `- name:`
    // marker to the next `- name:` marker), not the whole file - a
    // preceding explanatory comment is allowed to mention the token name;
    // the step itself must not wire it in as env.
    const stepStart = publish.indexOf("- name: Publish to npm");
    expect(stepStart).toBeGreaterThan(-1);
    const nextStepStart = publish.indexOf("- name:", stepStart + 1);
    expect(nextStepStart).toBeGreaterThan(stepStart);
    const publishStep = publish.slice(stepStart, nextStepStart);

    expect(publishStep).toContain("npm publish");
    expect(publishStep).toContain("--provenance");
    expect(publishStep).not.toContain("NODE_AUTH_TOKEN");
    expect(publishStep).not.toContain("NPM_TOKEN");
    expect(publishStep).not.toContain("env:");

    // Publication happens before tag/release creation, never after - a
    // failed `npm publish` (set -euo pipefail) must never leave a tag or
    // GitHub Release pointing at something that was never actually
    // published.
    const tagStepStart = publish.indexOf("- name: Tag the release");
    expect(tagStepStart).toBeGreaterThan(stepStart);
  });
});
