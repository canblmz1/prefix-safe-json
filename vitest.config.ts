import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      exclude: [
        "**/dist/**",
        "**/.stryker-tmp/**",
        "**/scripts/**",
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
