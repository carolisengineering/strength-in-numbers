import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { TEST_ENV, buildTestApp, limitsWith } from "../helpers/build-test-app.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

describe("15 AC11 — GET /healthz reports the commit", () => {
  it("answers 200 { status, commit } with exactly those keys", async () => {
    const { app } = await buildTestApp({ config: loadConfig({ ...TEST_ENV, SIN_COMMIT: SHA }) });
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toStrictEqual({ status: "ok", commit: SHA });
  });

  it("reports dev with no commit in the environment", async () => {
    const { app } = await buildTestApp();
    expect((await app.inject({ method: "GET", url: "/healthz" })).json()).toStrictEqual({ status: "ok", commit: "dev" });
  });

  it("makes no readiness (DB) call", async () => {
    let calls = 0;
    const { app } = await buildTestApp({ checkReadiness: async () => void calls++ });
    await app.inject({ method: "GET", url: "/healthz" });
    expect(calls).toBe(0);
  });

  it("is never rate limited (skipRateLimit)", async () => {
    const { app } = await buildTestApp({ rateLimits: limitsWith({ ip: 5 }) });
    for (let i = 0; i < 101; i++) expect((await app.inject({ method: "GET", url: "/healthz" })).statusCode).toBe(200);
  });

  it("stays out of /openapi.json", async () => {
    const { app } = await buildTestApp();
    const doc = (await app.inject({ method: "GET", url: "/openapi.json" })).json() as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths)).not.toContain("/healthz");
  });
});
