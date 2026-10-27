import { describe, expect, it } from "vitest";
import { AS_A, buildHevyApp } from "../helpers/hevy-users.js";

const EX = "0192a1b2-0000-7000-8000-000000000101";
const pair = { hevyTemplateId: "T1", hevyTitle: "Bench", hevyType: "weight_reps", role: "exercise", exerciseId: EX, measureRule: null, exportAs: true };

describe("19.0 AC21 / AC22 / AC24 — mapping route shapes (fake repository)", () => {
  it("GET: the mapping shape, a strong ETag, 304 on a match, private no-cache", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({ method: "GET", url: "/v1/hevy/mapping", headers: AS_A });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pairs: [], sectionRules: [] });
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    const again = await app.inject({ method: "GET", url: "/v1/hevy/mapping", headers: { ...AS_A, "if-none-match": String(res.headers.etag) } });
    expect(again.statusCode).toBe(304);
  });

  it("PUT returns the mapping read shape (exerciseActive included); no-store", async () => {
    const { app } = await buildHevyApp();
    const res = await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: AS_A, payload: { pairs: [pair], sectionRules: [] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ pairs: [{ ...pair, exerciseActive: true }], sectionRules: [] });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("PATCH {} and a patch over 200 upserts are 422", async () => {
    const { app } = await buildHevyApp();
    expect((await app.inject({ method: "PATCH", url: "/v1/hevy/mapping", headers: AS_A, payload: {} })).statusCode).toBe(422);
    const upsert = Array.from({ length: 201 }, (_, i) => ({ ...pair, hevyTemplateId: `T${i}` }));
    expect((await app.inject({ method: "PATCH", url: "/v1/hevy/mapping", headers: AS_A, payload: { upsert } })).statusCode).toBe(422);
  });
});
