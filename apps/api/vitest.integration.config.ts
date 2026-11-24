import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/**
 * Issue 361: the integration suite's own config. Its global setup starts one Postgres for the whole run (migrated
 * once), and each file takes a database of its own on it. The default config has no global setup, so a unit run can
 * never start Docker.
 *
 * The base config is spread, not merged: `mergeConfig` joins arrays, which would add the unit files to `include`.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["test/integration/**/*.test.ts"],
    // The shared-db test fails if a worker under this config can't see the shared server's address.
    env: { ...base.test?.env, SIN_IT_EXPECT_SHARED_PG: "1" },
    globalSetup: ["./test/integration/global-setup.ts"],
  },
});
