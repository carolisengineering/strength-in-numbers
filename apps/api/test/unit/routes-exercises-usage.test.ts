import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };

describe("03.4 AC26 — no route collision", () => {
  it("Review Focus 1 — GET /v1/exercises/usage reaches findUsage, never the :id lookup", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    let visibleLookups = 0;
    const original = exerciseRepo.findVisibleById.bind(exerciseRepo);
    exerciseRepo.findVisibleById = async (...args) => {
      visibleLookups += 1;
      return original(...args);
    };
    exerciseRepo.usage = [{ rootId: "018f9c8e-0000-7000-8000-000000000021", lastLoggedOn: "2026-10-24" }];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const res = await app.inject({ method: "GET", url: "/v1/exercises/usage", headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ exercises: [{ rootId: "018f9c8e-0000-7000-8000-000000000021", lastLoggedOn: "2026-10-24" }] });
    expect(visibleLookups).toBe(0);
  });
});

describe("Minor 115 — the usage and routines-using routes map their reads", () => {
  it("GET /v1/exercises/usage: each row mapped, an ETag, private no-cache, and a matching If-None-Match is 304", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.usage = [
      { rootId: "018f9c8e-0000-7000-8000-000000000021", lastLoggedOn: "2026-10-24" },
      { rootId: "018f9c8e-0000-7000-8000-000000000022", lastLoggedOn: "2026-09-01" },
    ];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const res = await app.inject({ method: "GET", url: "/v1/exercises/usage", headers: BEARER });
    expect(res.json()).toEqual({ exercises: exerciseRepo.usage });
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"/);
    const again = await app.inject({ method: "GET", url: "/v1/exercises/usage", headers: { ...BEARER, "if-none-match": etag } });
    expect(again.statusCode).toBe(304);
  });

  it("GET /v1/exercises/{id}/routines: the fake's routinesUsing, mapped (oneOffUntil as ISO or null), no-store and no ETag", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord({ name: "Bench" });
    exerciseRepo.byId.set(ex.id, ex);
    const until = new Date("2026-11-10T09:00:00.000Z");
    exerciseRepo.routinesUsing.set(ex.id, [
      { id: "018f9c8e-0000-7000-8000-0000000000a1", name: "Push", oneOffUntil: null },
      { id: "018f9c8e-0000-7000-8000-0000000000a2", name: "Class", oneOffUntil: until },
    ]);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const res = await app.inject({ method: "GET", url: `/v1/exercises/${ex.id}/routines`, headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      routines: [
        { id: "018f9c8e-0000-7000-8000-0000000000a1", name: "Push", oneOffUntil: null },
        { id: "018f9c8e-0000-7000-8000-0000000000a2", name: "Class", oneOffUntil: "2026-11-10T09:00:00.000Z" },
      ],
    });
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.etag).toBeUndefined();
  });

  it("an exercise used by no routine is an empty list; an unknown one is 404", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const ex = makeExerciseRecord({ name: "Row" });
    exerciseRepo.byId.set(ex.id, ex);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    expect((await app.inject({ method: "GET", url: `/v1/exercises/${ex.id}/routines`, headers: BEARER })).json()).toEqual({ routines: [] });
    expect((await app.inject({ method: "GET", url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff/routines", headers: BEARER })).statusCode).toBe(404);
  });
});
