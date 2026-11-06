import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests only: no k6, no network. The end-to-end runs are dev-tool checks (Spec 16 AC15, AC17).
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
