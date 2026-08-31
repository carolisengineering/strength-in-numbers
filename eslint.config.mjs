import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  URL: "readonly",
  Buffer: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  fetch: "readonly",
  __dirname: "readonly",
};

export default tseslint.config(
  { ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      globals: { ...nodeGlobals, CryptoKey: "readonly" },
      parserOptions: { projectService: false },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["error", "warn"] }],
    },
  },
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: { globals: nodeGlobals },
    rules: { "no-console": "off" },
  },
);
