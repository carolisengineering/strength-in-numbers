import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/main.tsx",
        "src/test/**",
      ],
      // Spec 04.0 §10 — the security-load-bearing modules are held at >= 90%
      // line coverage (the browser analogue of Spec 01's auth-plugin gate).
      thresholds: {
        "src/api/**": { lines: 90 },
        "src/auth/**": { lines: 90 },
      },
    },
  },
});
