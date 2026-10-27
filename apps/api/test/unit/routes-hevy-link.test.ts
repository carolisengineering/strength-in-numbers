import { describe, expect, it } from "vitest";
import { AS_A, buildHevyApp } from "../helpers/hevy-users.js";

const WORKOUT = "0192a1b2-0000-7000-8000-000000000001";
const url = `/v1/workouts/${WORKOUT}/hevy-link`;

describe("19.0 AC26–AC30 / AC33 — link route shapes and no-store (fake repository)", () => {
  it("begin with no body (the usual case) is 200 with a v1 fingerprint the server computed", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({ method: "POST", url, headers: AS_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ mode: "create", hevyWorkoutId: null, staleClaim: false, fingerprint: expect.stringMatching(/^v1:[0-9a-f]{64}$/) });
  });

  it("begin takes { relink: true } and refuses anything else", async () => {
    const { app } = await buildHevyApp();
    expect((await app.inject({ method: "POST", url, headers: AS_A, payload: { relink: true } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url, headers: AS_A, payload: { relink: false } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url, headers: AS_A, payload: { apiKey: "x" } })).statusCode).toBe(422);
  });

  it("complete returns the link read shape; read and release; no-store everywhere", async () => {
    const { app } = await buildHevyApp();
    const begun = (await app.inject({ method: "POST", url, headers: AS_A })).json() as { fingerprint: string };
    const done = await app.inject({ method: "PUT", url, headers: AS_A, payload: { hevyWorkoutId: "H1", fingerprint: begun.fingerprint } });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toEqual({ state: "sent", hevyWorkoutId: "H1", origin: "sent", syncedAt: null });
    const read = await app.inject({ method: "GET", url, headers: AS_A });
    expect(read.headers["cache-control"]).toBe("no-store");
    const released = await app.inject({ method: "DELETE", url, headers: AS_A });
    expect(released.statusCode).toBe(204);
    expect(released.body).toBe("");
  });
});
