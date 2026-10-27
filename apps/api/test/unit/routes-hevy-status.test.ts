import { describe, expect, it } from "vitest";
import { AS_A, AS_B, buildHevyApp } from "../helpers/hevy-users.js";

describe("19.0 AC18 — status", () => {
  it("an allowed user gets enabled, the counts and no-store", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({ method: "GET", url: "/v1/hevy/status", headers: AS_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ enabled: true, pairCount: 0, linkCount: 0, recordsStale: false });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("anyone else gets 404", async () => {
    const { app } = await buildHevyApp();
    expect((await app.inject({ method: "GET", url: "/v1/hevy/status", headers: AS_B })).statusCode).toBe(404);
  });
});
