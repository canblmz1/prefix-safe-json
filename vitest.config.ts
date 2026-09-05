import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      // Global (project-wide) floors, not per-file: per-file thresholds
      // would fail immediately against legitimately-lower-coverage
      // defensive branches (e.g. semantic/snapshot.ts's internal-invariant
      // guards, which are unreachable from attacker-controlled JSON input
      // and are intentionally untested for that reason).
      //
      // Set to exactly 95 on every metric to faithfully enforce RELEASE.md's
      // documented "Verify Code Coverage (`npm run test:coverage`) >= 95%"
      // bar - not a headroom-padded number invented independently of that
      // policy. All four metrics clear this today (99.50% stmt / 96.98%
      // branch / 98.99% funcs / 99.50% lines), branches with the thinnest
      // margin (~1.98 points). Confirmed empirically (not assumed) that
      // Vitest's threshold check passes when the 2-decimal-rounded actual
      // value is >= the threshold, so 95 here means exactly ">=95%",
      // matching RELEASE.md's own wording with no adjustment needed - unlike
      // stryker.config.json's break threshold, whose comparison required a
      // small correction to faithfully express a *strict* ">" requirement.
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
      exclude: [
        "**/dist/**",
        "**/.stryker-tmp/**",
        "**/scripts/**",
        "**/examples/**",
        "**/test/**",
        // Not a blanket "**/types.ts" (as this used to be): every types.ts
        // in the project was pure type/interface declarations when that
        // pattern was written, but src/validation/types.ts no longer is -
        // it now holds real runtime logic (buildValidatorMap and its
        // validation helpers), which a blanket pattern would silently drop
        // from every coverage number below without any signal that it
        // happened. Named explicitly per remaining type-only file instead.
        "src/types.ts",
        "**/coordinator/types.ts",
        "**/gate/types.ts",
        "**/guard/types.ts",
        "**/conformance/types.ts",
        "**/protocol.ts",
        "**/adapter.ts",
        "**/events.ts",
        "**/index.ts",
        "**/stryker.config.json",
        "*.config.*",
        "test-import.js",
      ],
    },
  },
});
