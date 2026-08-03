import { defineConfig } from "vitest/config";

export default defineConfig({
  coverage: {
    provider: "v8",
    exclude: [
      "scripts/**",
      "test/**",
      "src/**/types.ts",
      "src/**/protocol.ts",
      "src/**/adapter.ts",
      "src/**/events.ts",
      "src/index.ts",
      "stryker.config.json"
    ],
  },
  test: {
    include: ["test/**/*.test.ts"],
    globals: false,
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
