import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * Issue 361: the integration suite's own config. Its global setup starts one Postgres for the whole run (migrated
 * once), and each file takes a database of its own on it. The default config has no global setup, so a unit run can
 * never start Docker.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["test/integration/**/*.test.ts"],
      globalSetup: ["./test/integration/global-setup.ts"],
    },
  }),
);
