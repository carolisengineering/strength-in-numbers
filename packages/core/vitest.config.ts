import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    typecheck: {
      // Type-level assertions (Spec 02 §2 AC5, AC9) live in test/types/*.test-d.ts
      // and run under `vitest --typecheck`.
      enabled: true,
      include: ["test/types/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts"],
    },
  },
});
