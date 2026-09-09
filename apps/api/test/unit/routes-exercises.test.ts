import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import {
  FakeExerciseRepository,
  fakeVerifier,
  makeExerciseRecord,
} from "../helpers/fakes.js";
import { InvalidTokenError } from "../../src/errors/app-error.js";

const BEARER = { authorization: "Bearer test-token" };

const DTO_KEYS = [
  "id",
  "catalogKey",
  "ownerUserId",
  "name",
  "modality",
  "primaryMuscleId",
  "secondaryMuscleIds",
  "equipmentId",
  "isActive",
  "createdAt",
  "updatedAt",
].sort();


/** `Vary` must carry the CORS plugin's `Origin` *and* our `Authorization`. */
function expectVaryTokens(vary: unknown): void {
  const tokens = String(vary).split(",").map((t) => t.trim().toLowerCase());
  expect(tokens).toContain("origin");
  expect(tokens).toContain("authorization");
}

describe("GET /v1/exercises — full pull (AC5)", () => {
  it("returns the caller-visible catalog as camelCase Exercise DTOs", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [
      makeExerciseRecord({ name: "Back Squat", catalogKey: "back-squat" }),
    ];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.serverTime).toBe("string");
    expect(body.exercises).toHaveLength(1);
    expect(Object.keys(body.exercises[0]).sort()).toEqual(DTO_KEYS);
    expect(body.exercises[0]).toMatchObject({
      name: "Back Squat",
      catalogKey: "back-squat",
      modality: "weight_reps",
      ownerUserId: null,
      secondaryMuscleIds: [],
      isActive: true,
      createdAt: "2026-09-01T10:00:00.000Z",
    });
  });

  it("threads the acting user's id into the visibility filter", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({
      exerciseRepository: exerciseRepo,
    });

    await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });

    const user = await repo.findByAuthSub("auth0|user-123");
    expect(exerciseRepo.lastActingUserId).toBe(user!.id);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({ method: "GET", url: "/v1/exercises" });
    expect(res.statusCode).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("GET /v1/exercises — ETag / 304 / caching (AC7)", () => {
  it("emits a strong ETag that is stable while only serverTime advances", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    exerciseRepo.serverTime = new Date("2026-09-08T00:00:00.000Z");
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const a = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const etag = a.headers.etag as string;
    expect(etag).toMatch(/^"[0-9a-f]{32}"$/);

    exerciseRepo.serverTime = new Date("2026-09-09T12:00:00.000Z");
    const b = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(b.headers.etag).toBe(etag);
    expect(b.json().serverTime).toBe("2026-09-09T12:00:00.000Z");
  });

  it("If-None-Match match → 304, empty body, ETag + cache headers", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const first = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const etag = first.headers.etag as string;

    const second = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, "if-none-match": etag },
    });
    expect(second.statusCode).toBe(304);
    expect(second.body).toBe("");
    expect(second.headers.etag).toBe(etag);
    expect(second.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(second.headers.vary);
  });

  it("200 carries Cache-Control: private, no-cache + Vary: Authorization", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(res.headers.vary);
  });

  it("Vary keeps the CORS plugin's Origin token alongside Authorization", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, origin: "http://localhost:5173" },
    });
    expect(res.statusCode).toBe(200);
    const tokens = String(res.headers.vary)
      .split(",")
      .map((t) => t.trim().toLowerCase());
    expect(tokens).toContain("origin");
    expect(tokens).toContain("authorization");
  });

  it("a catalog change produces a different ETag and a 200 (not 304)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord({ name: "Squat" })];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const before = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });

    exerciseRepo.catalog = [
      ...exerciseRepo.catalog,
      makeExerciseRecord({ name: "Bench" }),
    ];
    const after = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: { ...BEARER, "if-none-match": before.headers.etag as string },
    });
    expect(after.statusCode).toBe(200);
    expect(after.headers.etag).not.toBe(before.headers.etag);
  });

  it("a delta that serializes to the same bytes as an earlier full pull gets a different ETag", async () => {
    const rec = makeExerciseRecord({ name: "Row" });
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [rec];
    exerciseRepo.delta = [rec];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const full = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const delta = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=2026-01-01T00:00:00.000Z",
      headers: BEARER,
    });
    expect(full.headers.etag).not.toBe(delta.headers.etag);

    // a full-pull ETag replayed against the delta must NOT 304
    const replay = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=2026-01-01T00:00:00.000Z",
      headers: { ...BEARER, "if-none-match": full.headers.etag as string },
    });
    expect(replay.statusCode).toBe(200);
  });

  it("HEAD /v1/exercises returns the same ETag + cache headers, no body", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecord()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const get = await app.inject({
      method: "GET",
      url: "/v1/exercises",
      headers: BEARER,
    });
    const head = await app.inject({
      method: "HEAD",
      url: "/v1/exercises",
      headers: BEARER,
    });
    expect(head.statusCode).toBe(200);
    expect(head.headers.etag).toBe(get.headers.etag);
    expect(head.headers["cache-control"]).toBe("private, no-cache");
    expectVaryTokens(head.headers.vary);
    expect(head.body).toBe("");
  });
});

describe("GET /v1/exercises — updated_since delta (AC6)", () => {
  it("routes ?updated_since=<rfc3339> to the delta path with that exact value", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.delta = [
      makeExerciseRecord({ name: "Changed", isActive: false }),
    ];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=2026-09-01T00:00:00.000Z",
      headers: BEARER,
    });

    expect(res.statusCode).toBe(200);
    expect(exerciseRepo.lastDeltaSince).toBe("2026-09-01T00:00:00.000Z");
    expect(res.json().exercises[0]).toMatchObject({
      name: "Changed",
      isActive: false,
    });
  });

  it("a malformed updated_since → 422 validation-error naming the param", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=not-a-date",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.type).toContain("validation-error");
    expect(
      body.errors.some((e: { path: string }) => e.path.includes("updated_since")),
    ).toBe(true);
  });

  it("a future updated_since relays an empty delta plus a serverTime", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.delta = [];
    exerciseRepo.serverTime = new Date("2026-09-08T00:00:00.000Z");
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "GET",
      url: "/v1/exercises?updated_since=2099-01-01T00:00:00.000Z",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      exercises: [],
      serverTime: "2026-09-08T00:00:00.000Z",
    });
  });
});
