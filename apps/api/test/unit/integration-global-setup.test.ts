import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import setup from "../integration/global-setup.js";
import { SHARED_PG_ENV } from "../integration/helpers.js";

const apiRoot = fileURLToPath(new URL("../../", import.meta.url));
const read = (rel: string) => readFileSync(`${apiRoot}${rel}`, "utf8");

describe("issue 361 — the integration global setup", () => {
  const before = { run: process.env.RUN_INTEGRATION, shared: process.env[SHARED_PG_ENV] };
  afterEach(() => {
    for (const [key, value] of [["RUN_INTEGRATION", before.run], [SHARED_PG_ENV, before.shared]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("starts nothing without RUN_INTEGRATION=1: no shared address, and a teardown that does nothing", async () => {
    delete process.env.RUN_INTEGRATION;
    delete process.env[SHARED_PG_ENV];
    const teardown = await setup();
    expect(process.env[SHARED_PG_ENV]).toBeUndefined();
    await expect(teardown()).resolves.toBeUndefined();
  });

  it("only the integration config has the global setup, so a unit run can never start Docker", () => {
    expect(read("vitest.config.ts")).not.toMatch(/globalSetup/);
    expect(read("vitest.integration.config.ts")).toMatch(/globalSetup:\s*\["\.\/test\/integration\/global-setup\.ts"\]/);
  });

  it("test:integration uses the integration config; test:unit and test don't", () => {
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["test:integration"]).toBe("vitest run --config vitest.integration.config.ts");
    expect(scripts["test:unit"]).not.toMatch(/integration/);
    expect(scripts["test"]).not.toMatch(/--config/);
  });
});
