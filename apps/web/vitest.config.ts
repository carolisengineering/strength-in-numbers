import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { COVERAGE_PROVIDER, coverageGates } from "./coverage-gates";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: COVERAGE_PROVIDER,
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/*.test.{ts,tsx}",
        "src/**/index.ts",
        "src/main.tsx",
        "src/test/**",
      ],
      // The 90% line gates, off in a CI shard (issue 361): ./coverage-gates.ts.
      thresholds: coverageGates(process.env),
    },
  },
});
