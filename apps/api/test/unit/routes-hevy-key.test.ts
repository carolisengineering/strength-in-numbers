import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { AS_A, buildHevyApp } from "../helpers/hevy-users.js";

describe("19.0 AC34 — the Hevy key never reaches the server", () => {
  it("a mapping body carrying apiKey is 422 (strict)", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: AS_A, payload: { pairs: [], sectionRules: [], apiKey: "x" } });
    expect(res.statusCode).toBe(422);
  });

  it("a preflight asking for an api-key header is not allowed it", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({
      method: "OPTIONS",
      url: "/v1/hevy/mapping",
      headers: { origin: "http://localhost:5173", "access-control-request-method": "PUT", "access-control-request-headers": "api-key" },
    });
    expect(String(res.headers["access-control-allow-headers"] ?? "").toLowerCase()).not.toContain("api-key");
  });

  it("an api-key header's value is never logged", async () => {
    const lines: string[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(s) });
    const { app } = await buildHevyApp({ logger });
    await app.inject({ method: "GET", url: "/v1/hevy/status", headers: { ...AS_A, "api-key": "SECRET123" } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("SECRET123");
  });
});
