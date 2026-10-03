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
        "src/**/*.test.{ts,tsx}",
        "src/**/index.ts",
        "src/main.tsx",
        "src/test/**",
      ],
      // Spec 04.0 §10 — the security-load-bearing modules are held at >= 90%
      // line coverage (the browser analogue of Spec 01's auth-plugin gate).
      // Spec 06.0 AC31 adds the catalog client and the storage seam: a silent
      // bug there (a reset loop, a leaked forked origin, a storage failure
      // that crashes the app) is user-visible and hard to diagnose.
      // Spec 06.1 AC36 adds the workout screen: a bug in set logging loses a
      // lifter's data, and the failure matrix is the part that rots.
      thresholds: {
        "src/api/**": { lines: 90 },
        "src/auth/**": { lines: 90 },
        "src/features/catalog/**": { lines: 90 },
        "src/features/workouts/**": { lines: 90 },
        "src/storage/**": { lines: 90 },
      },
    },
  },
});
