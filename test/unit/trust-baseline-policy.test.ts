import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * Extracts one top-level GitHub Actions job's own block (its `  name:`
 * line through, but not including, the next 2-space-indented top-level
 * key - another job, or end of file if it's the last one) as plain text.
 * Deliberately not a YAML parser: workflow job names and nothing else in
 * this file sit at exactly 2-space indent, which is enough to scope a
 * plain-text policy assertion to one job without a new dependency. See
 * "requires npm Trusted Publishing..." below for why this matters - a
 * whole-file `toContain()` cannot tell a value inside `publish:` apart
 * from the same value having moved to some other job.
 */
function extractJobBlock(workflowText: string, jobName: string): string {
  const lines = workflowText.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);
  if (startIndex === -1) {
    throw new Error(`could not find top-level job "${jobName}:" in workflow`);
  }
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^ {2}[A-Za-z_][\w-]*:\s*$/.test(line)) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(startIndex, endIndex).join("\n");
}

/** Blanks out full comment lines (trimmed content starting with `#`) so a
 * line that explains *why* there's no token here, by name, cannot itself
 * fail a `not.toContain`/`not.toMatch` check for that name. Every comment
 * in this workflow is a full line, never a trailing inline comment after
 * real YAML content, so this is sufficient here without a YAML parser. */
function stripFullLineComments(block: string): string {
  return block
    .split(/\r?\n/)
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

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

  it("requires npm Trusted Publishing for releases, with no legacy token fallback reachable by the publish job", () => {
    const workflow = read(".github/workflows/publish.yml");
    // Comments blanked out BEFORE any check below, presence or absence
    // alike - a comment mentioning `environment: npm-publish` (this file
    // has one, explaining why the gate exists) must not let a presence
    // check pass once the real directive is gone, the same way a comment
    // naming the legacy token must not fail an absence check.
    const publishJob = stripFullLineComments(extractJobBlock(workflow, "publish"));

    // Scoped specifically to the publish: job's own block, not the whole
    // file - gated behind every existing release gate, the protected
    // environment, and job-scoped OIDC. A whole-file toContain() would
    // still pass if any of these moved to a different job; extracting
    // the block first means it would not.
    expect(publishJob).toMatch(
      /needs:\s*\[release-intent,\s*test-matrix,\s*coverage,\s*mutation-test,\s*release-fuzz\]/,
    );
    expect(publishJob).toContain("environment: npm-publish");
    expect(publishJob).toMatch(/permissions:\n(?:.*\n)*?\s*contents:\s*write/);
    expect(publishJob).toMatch(/permissions:\n(?:.*\n)*?\s*id-token:\s*write/);

    // No active YAML assignment of the legacy token anywhere in the
    // publish job - at job level or inside any step, not only the
    // "Publish to npm" step checked specifically below.
    expect(publishJob).not.toMatch(/\bNODE_AUTH_TOKEN\s*:/);
    expect(publishJob).not.toMatch(/\bNPM_TOKEN\s*:/);
    expect(publishJob).not.toContain("${{ secrets.NPM_TOKEN }}");

    // Also check workflow-level scope (everything before `jobs:`) - a
    // token injected there would apply to every job including publish,
    // without the string ever appearing inside the publish: block itself.
    const jobsMatch = /\njobs:\r?\n/.exec(workflow);
    if (!jobsMatch) {
      throw new Error('could not find "jobs:" in workflow');
    }
    const workflowLevel = stripFullLineComments(workflow.slice(0, jobsMatch.index));
    expect(workflowLevel).not.toMatch(/\bNODE_AUTH_TOKEN\s*:/);
    expect(workflowLevel).not.toMatch(/\bNPM_TOKEN\s*:/);

    // The actual "Publish to npm" step, still checked specifically: real
    // publish invocation, with provenance, and no step-level env: block
    // at all - the strongest, most specific form of "no token here".
    const stepStart = publishJob.indexOf("- name: Publish to npm");
    expect(stepStart).toBeGreaterThan(-1);
    const nextStepStart = publishJob.indexOf("- name:", stepStart + 1);
    expect(nextStepStart).toBeGreaterThan(stepStart);
    const publishStep = publishJob.slice(stepStart, nextStepStart);

    expect(publishStep).toContain("npm publish");
    expect(publishStep).toContain("--provenance");
    expect(publishStep).not.toContain("env:");

    // Publication happens before tag/release creation, never after - a
    // failed `npm publish` (set -euo pipefail) must never leave a tag or
    // GitHub Release pointing at something that was never actually
    // published.
    const tagStepStart = publishJob.indexOf("- name: Tag the release");
    expect(tagStepStart).toBeGreaterThan(stepStart);
  });
});
