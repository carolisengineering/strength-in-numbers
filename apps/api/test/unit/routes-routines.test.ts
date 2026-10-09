import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const EX = makeExerciseRecord({ name: "Bench" });

async function appWithExercise() {
  const exerciseRepo = new FakeExerciseRepository();
  exerciseRepo.byId.set(EX.id, EX);
  const routineRepo = new FakeRoutineRepository(exerciseRepo);
  // GENEROUS_LIMITS: the cap test sends 51 writes, past the real `routines` group (AC25 is its own test).
  const { app } = await buildTestApp({ exerciseRepository: exerciseRepo, routineRepository: routineRepo, rateLimits: GENEROUS_LIMITS });
  return { app, exerciseRepo, routineRepo };
}
const body = (over: Record<string, unknown> = {}) => ({
  name: "Push A",
  items: [
    { exerciseId: EX.id, targetRpe: 8.5, supersetGroup: 7 },
    { exerciseId: EX.id, supersetGroup: 7 },
  ],
  ...over,
});
type ItemShape = { id: string; position: number; targetRpe: number | null; supersetGroup: number | null };

describe("AC1 — contract & auth", () => {
  it.each([
    ["GET", "/v1/routines"],
    ["GET", `/v1/routines/${uuidv7()}`],
    ["POST", "/v1/routines"],
    ["PUT", `/v1/routines/${uuidv7()}`],
    ["DELETE", `/v1/routines/${uuidv7()}`],
  ])("%s %s is 401 problem+json without a token", async (method, url) => {
    const { app } = await appWithExercise();
    const res = await app.inject({ method: method as "GET", url });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });
});

describe("AC5 / AC11 / AC12 — POST /v1/routines", () => {
  it("201 + Location + the stored routine with dense positions, decimal RPE and renumbered groups", async () => {
    const { app } = await appWithExercise();
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    expect(res.statusCode).toBe(201);
    expect(res.headers.location).toBe(`/v1/routines/${res.json().id}`);
    expect((res.json().items as ItemShape[]).map((i) => [i.position, i.targetRpe, i.supersetGroup])).toEqual([
      [0, 8.5, 1],
      [1, null, 1],
    ]);
    expect(res.json().notes).toBeNull();
    expect(Object.keys(res.json())).toEqual(["id", "name", "notes", "items", "createdAt", "updatedAt"]);
  });
  it("AC11 — a position key on an item is a 422 naming the item", async () => {
    const { app } = await appWithExercise();
    const res = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: body({ items: [{ exerciseId: EX.id, position: 0 }] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.map((e: { path: string }) => e.path)).toContain("items.0");
  });
  it("AC9 / AC12 — every cross-item problem comes back in one 422", async () => {
    const { app } = await appWithExercise();
    const res = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: body({ items: [{ exerciseId: EX.id, supersetGroup: 1 }, { exerciseId: EX.id, targetRepsLow: 5 }] }),
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.map((e: { path: string }) => e.path).sort()).toEqual([
      "items.0.supersetGroup",
      "items.1.targetRepsHigh",
    ]);
  });
  it("AC6 / AC7 — 409 routine-name-taken and 409 routine-limit from the repository", async () => {
    const { app, routineRepo } = await appWithExercise();
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    const dup = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body({ name: "push a" }) });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().type).toContain("routine-name-taken");
    for (let i = 1; i < 50; i += 1) {
      await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body({ name: `R${i}` }) });
    }
    expect(routineRepo.routines.size).toBe(50);
    const over = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body({ name: "R50" }) });
    expect(over.statusCode).toBe(409);
    expect(over.json().type).toContain("routine-limit");
  });
  it("AC8 — a retired exercise is 409 exercise-retired with errors[0].path = items.<i>.exerciseId", async () => {
    const { app, exerciseRepo } = await appWithExercise();
    const retired = makeExerciseRecord({ isActive: false });
    exerciseRepo.byId.set(retired.id, retired);
    const res = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: body({ items: [{ exerciseId: EX.id }, { exerciseId: retired.id }] }),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-retired");
    expect(res.json().errors).toEqual([{ path: "items.1.exerciseId", message: "exercise is retired" }]);
  });
});

describe("AC3 / AC4 — reads, ETag, 304, cache policy", () => {
  it("GET one: 200 with ETag + private, no-cache; If-None-Match (strong, weak, *) → 304 with no body; absent/malformed → identical 404 no-store", async () => {
    const { app } = await appWithExercise();
    const created = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    const id = created.json().id;
    const res = await app.inject({ method: "GET", url: `/v1/routines/${id}`, headers: BEARER });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    const etag = res.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);
    for (const inm of [etag, `W/${etag}`, "*"]) {
      const r = await app.inject({ method: "GET", url: `/v1/routines/${id}`, headers: { ...BEARER, "if-none-match": inm } });
      expect(r.statusCode, inm).toBe(304);
      expect(r.body).toBe("");
      expect(r.headers["cache-control"]).toBe("private, no-cache");
    }
    const missing = await app.inject({ method: "GET", url: `/v1/routines/${uuidv7()}`, headers: BEARER });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers["cache-control"]).toBe("no-store");
    const malformed = await app.inject({ method: "GET", url: "/v1/routines/nope", headers: BEARER });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toEqual({ ...missing.json(), instance: malformed.json().instance });
  });
  it("list: ETag + 304; list and single never share a validator; a write changes the list ETag; write responses are no-store", async () => {
    const { app } = await appWithExercise();
    const created = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    expect(created.headers["cache-control"]).toBe("no-store");
    const list1 = await app.inject({ method: "GET", url: "/v1/routines", headers: BEARER });
    expect(list1.statusCode).toBe(200);
    expect(list1.json().routines).toHaveLength(1);
    expect(list1.headers["cache-control"]).toBe("private, no-cache");
    const one = await app.inject({ method: "GET", url: `/v1/routines/${created.json().id}`, headers: BEARER });
    expect(list1.headers.etag).not.toBe(one.headers.etag);
    const notModified = await app.inject({
      method: "GET",
      url: "/v1/routines",
      headers: { ...BEARER, "if-none-match": list1.headers.etag as string },
    });
    expect(notModified.statusCode).toBe(304);
    const put = await app.inject({
      method: "PUT",
      url: `/v1/routines/${created.json().id}`,
      headers: BEARER,
      payload: body({ name: "Push B" }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.headers["cache-control"]).toBe("no-store");
    const list2 = await app.inject({ method: "GET", url: "/v1/routines", headers: BEARER });
    expect(list2.headers.etag).not.toBe(list1.headers.etag);
  });
});

describe("AC13 / AC15 — PUT and DELETE", () => {
  it("PUT 200 replaces with new item ids; 404 for absent; DELETE 204 then 404", async () => {
    const { app } = await appWithExercise();
    const created = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    const id = created.json().id;
    const put = await app.inject({
      method: "PUT",
      url: `/v1/routines/${id}`,
      headers: BEARER,
      payload: body({ items: [{ exerciseId: EX.id }] }),
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().items).toHaveLength(1);
    expect(put.json().items[0].id).not.toBe(created.json().items[0].id);
    const absent = await app.inject({ method: "PUT", url: `/v1/routines/${uuidv7()}`, headers: BEARER, payload: body() });
    expect(absent.statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/v1/routines/${id}`, headers: BEARER })).statusCode).toBe(204);
    expect((await app.inject({ method: "DELETE", url: `/v1/routines/${id}`, headers: BEARER })).statusCode).toBe(404);
  });
  it("AC14 — an If-Match header is accepted and ignored", async () => {
    const { app } = await appWithExercise();
    const created = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: body() });
    const put = await app.inject({
      method: "PUT",
      url: `/v1/routines/${created.json().id}`,
      headers: { ...BEARER, "if-match": '"stale"' },
      payload: body(),
    });
    expect(put.statusCode).toBe(200);
  });
});
