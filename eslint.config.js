import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["scripts/*.mjs", "test/scripts/adoption-watch.test.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-invalid-void-type": "off",
    },
  },
  {
    files: ["scripts/evaluate-sandbase-approval.mjs"],
    languageOptions: {
      // Plain JS needs the same syntax/rules, not an inferred TS project slot.
      parserOptions: { projectService: false },
    },
  },
  {
    ignores: [
      "dist/",
      "coverage/",
      "node_modules/",
      "*.js",
      "*.mjs",
    ],
  },
);
