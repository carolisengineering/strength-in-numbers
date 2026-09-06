import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
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

// apps/web runs in the browser — the first non-Node code in the repo
// (Spec 04.0 §6.1).
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  fetch: "readonly",
  crypto: "readonly",
  console: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  Element: "readonly",
  HTMLElement: "readonly",
  Node: "readonly",
  MutationObserver: "readonly",
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
  // apps/web — browser globals, JSX, and the React Hooks rules (Spec 04.0
  // §6.1 / §7 / §10). Picked up by the root `pnpm run lint` (`eslint .`).
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      globals: { ...browserGlobals },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  // apps/web config files run in Node at build/test time.
  {
    files: ["apps/web/*.{ts,mts,cts}"],
    languageOptions: { globals: { ...nodeGlobals, importMeta: "readonly" } },
  },
);
