import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeUserRepository, fakeVerifier, makeUser } from "../helpers/fakes.js";
import { InvalidTokenError } from "../../src/errors/app-error.js";

const BEARER = { authorization: "Bearer test-token" };
const JSON_HEADERS = { ...BEARER, "content-type": "application/json" };

const validCreateBody = {
  name: "Cable Fly",
  modality: "weight_reps",
};

describe("POST /v1/exercises (Spec 03.2 AC2, AC3)", () => {
  it("201s with catalogKey null, ownerUserId = caller, forkedFromExerciseId null, isActive true", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app, repo } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });

    expect(res.statusCode).toBe(201);
    const user = await repo.findByAuthSub("auth0|user-123");
    const body = res.json();
    expect(body).toMatchObject({
      catalogKey: null,
      ownerUserId: user!.id,
      forkedFromExerciseId: null,
      isActive: true,
      name: "Cable Fly",
      secondaryMuscleIds: [],
    });
    expect(res.headers.location).toBe(`/v1/exercises/${body.id}`);
  });

  it("preserves secondaryMuscleIds in submitted order", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    // Fake validateReferences rejects anything not in this list (mirrors the
    // Prisma implementation's real-FK check) — seed it so this test exercises
    // ordering, not validation.
    exerciseRepo.muscleGroups = ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      displayOrder: 0,
    }));
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { ...validCreateBody, secondaryMuscleIds: ["c", "a", "b"] },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().secondaryMuscleIds).toEqual(["c", "a", "b"]);
  });

  it("422 on bad name/modality", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { name: "", modality: "isometric_hold" },
    });
    expect(res.statusCode).toBe(422);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["name", "modality"]));
  });

  it("422 naming every unknown reference id together, not just the first", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: {
        ...validCreateBody,
        primaryMuscleId: "no-such-muscle",
        secondaryMuscleIds: ["also-missing"],
        equipmentId: "no-such-equipment",
      },
    });
    expect(res.statusCode).toBe(422);
    const paths = res.json().errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(["primaryMuscleId", "secondaryMuscleIds", "equipmentId"]),
    );
  });

  it("409 exercise-limit-reached once the (test-lowered) cap is hit", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.cap = 1;
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const first = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: { ...validCreateBody, name: "Second" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().type).toContain("exercise-limit-reached");
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: { "content-type": "application/json" },
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(401);
  });

  it("401 with an invalid token", async () => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises",
      headers: JSON_HEADERS,
      payload: validCreateBody,
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("PATCH /v1/exercises/{id} (Spec 03.2 AC4, AC5, AC8)", () => {
  it("200s in place: same id, updatedAt bumped", async () => {
    // Auth provisioning only creates the `user` row on the first authenticated
    // request (Spec 01) — this test needs the caller's id *before* the PATCH
    // request to seed an owned row, so it seeds the FakeUserRepository
    // directly with a user matching authContext()'s default authSub, rather
    // than deriving the id from a `findByAuthSub` that would still be null at
    // this point in the test (the brief's own literal test relies on
    // provisioning having already happened, which it hasn't here).
    const exerciseRepo = new FakeExerciseRepository();
    const userRepo = new FakeUserRepository();
    const user = makeUser({ authSub: "auth0|user-123" });
    userRepo.seed(user);
    const { app, exerciseRepo: er } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      userRepository: userRepo,
    });
    const row = er.byId
      .set("018f9c8e-0000-7000-8000-000000000001", {
        id: "018f9c8e-0000-7000-8000-000000000001",
        catalogKey: null,
        ownerUserId: user.id,
        name: "Old",
        modality: "weight_reps",
        primaryMuscleId: null,
        secondaryMuscleIds: [],
        equipmentId: null,
        isActive: true,
        forkedFromExerciseId: null,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-01T00:00:00.000Z"),
      })
      .get("018f9c8e-0000-7000-8000-000000000001")!;

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/exercises/${row.id}`,
      headers: JSON_HEADERS,
      payload: { name: "New" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: row.id, name: "New" });
    expect(new Date(res.json().updatedAt).getTime()).toBeGreaterThan(row.updatedAt.getTime());
  });

  it("409 exercise-immutable-use-fork on a global row", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const globalId = "018f9c8e-0000-7000-8000-000000000002";
    exerciseRepo.byId.set(globalId, {
      id: globalId,
      catalogKey: "back-squat",
      ownerUserId: null,
      name: "Back Squat",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/exercises/${globalId}`,
      headers: JSON_HEADERS,
      payload: { name: "Hijacked" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-immutable-use-fork");
  });

  it("404 on an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: JSON_HEADERS,
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: { "content-type": "application/json" },
      payload: { name: "x" },
    });
    expect(res.statusCode).toBe(401);
  });
});
