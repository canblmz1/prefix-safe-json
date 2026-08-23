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
      // and are intentionally untested for that reason). Set with
      // meaningful headroom below the measured baseline (99.03% stmt /
      // 95.66% branch / 98.81% funcs / 99.03% lines) so a real regression
      // still fails the build without today's exact numbers becoming a
      // brittle, must-match target.
      thresholds: {
        statements: 97,
        branches: 92,
        functions: 97,
        lines: 97,
      },
      exclude: [
        "**/dist/**",
        "**/.stryker-tmp/**",
        "**/scripts/**",
        "**/examples/**",
        "**/test/**",
        "**/types.ts",
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
