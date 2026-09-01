import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit suite runs with no external deps; integration suite (test/integration)
    // needs a Docker daemon for Testcontainers Postgres. CI runs them as
    // separate steps via the `test:unit` / `test:integration` scripts.
    include: ["test/**/*.test.ts"],
    environment: "node",
    hookTimeout: 120_000,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts", "src/**/*.d.ts"],
      thresholds: {
        // Spec 01 §2 criterion 19: auth plugin + user repo held >= 90%.
        "src/auth/**/*.ts": { lines: 90, functions: 90 },
        "src/plugins/auth.ts": { lines: 90, functions: 90 },
        "src/repositories/user.ts": { lines: 90, functions: 90 },
      },
    },
  },
});
