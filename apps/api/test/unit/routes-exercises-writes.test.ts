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

  it("I1 — 422 (not 500) when a PATCH names an unknown primaryMuscleId/secondaryMuscleIds/equipmentId", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const userRepo = new FakeUserRepository();
    const user = makeUser({ authSub: "auth0|user-123" });
    userRepo.seed(user);
    exerciseRepo.muscleGroups = [{ id: "chest", name: "Chest", displayOrder: 0 }];
    exerciseRepo.equipment = [{ id: "barbell", name: "Barbell", displayOrder: 0 }];
    const { app, exerciseRepo: er } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      userRepository: userRepo,
    });
    const id = "018f9c8e-0000-7000-8000-000000000004";
    er.byId.set(id, {
      id,
      catalogKey: null,
      ownerUserId: user.id,
      name: "Owned",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/v1/exercises/${id}`,
      headers: JSON_HEADERS,
      payload: {
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

describe("POST /v1/exercises/{id}/fork (Spec 03.2 AC6, AC7, AC8, AC10)", () => {
  const globalId = "018f9c8e-0000-7000-8000-000000000003";
  function seedGlobal(exerciseRepo: FakeExerciseRepository): void {
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
  }

  it("201s with a new id, Location header, forkedFromExerciseId = origin id", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).not.toBe(globalId);
    expect(body.forkedFromExerciseId).toBe(globalId);
    expect(body.catalogKey).toBeNull();
    expect(res.headers.location).toBe(`/v1/exercises/${body.id}`);
  });

  it("201s with NO request body at all (Finding 1 — overlay body is optional per Spec 03.2 §1, §5)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: BEARER,
      // No `payload` key and no content-type — a genuinely bodiless request,
      // the primary "fork this global exercise unchanged" use case.
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).not.toBe(globalId);
    expect(body.forkedFromExerciseId).toBe(globalId);
    expect(body.name).toBe("Back Squat");
  });

  it("still applies a real overlay body when one is sent", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: { name: "My Squat Variant" },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe("My Squat Variant");
  });

  it("422s on an invalid overlay body (unrecognized key)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: { notAField: true },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
  });

  it("422s on an invalid overlay body (empty name)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: { name: "" },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
  });

  it("409 exercise-already-owned when forking the caller's own row", async () => {
    // Same provisioning-order gotcha as the PATCH "200s in place" test above:
    // auth provisioning only creates the `user` row on the first authenticated
    // request, so the caller's id must be seeded directly rather than read
    // back via `findByAuthSub` before any request has been made.
    const exerciseRepo = new FakeExerciseRepository();
    const userRepo = new FakeUserRepository();
    const user = makeUser({ authSub: "auth0|user-123" });
    userRepo.seed(user);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      userRepository: userRepo,
    });
    const ownId = "018f9c8e-0000-7000-8000-000000000004";
    exerciseRepo.byId.set(ownId, {
      id: ownId,
      catalogKey: null,
      ownerUserId: user.id,
      name: "Mine",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${ownId}/fork`,
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-already-owned");
  });

  it("404 for an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff/fork",
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it("forkedFromExerciseId shows up in GET /v1/exercises and changes the ETag", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.catalog = [makeExerciseRecordForGet()];
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const before = await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });
    exerciseRepo.catalog = [
      ...exerciseRepo.catalog,
      { ...makeExerciseRecordForGet(), id: "018f9c8e-0000-7000-8000-000000000005", forkedFromExerciseId: exerciseRepo.catalog[0]!.id },
    ];
    const after = await app.inject({ method: "GET", url: "/v1/exercises", headers: BEARER });

    expect(after.headers.etag).not.toBe(before.headers.etag);
    expect(
      after.json().exercises.find((e: { forkedFromExerciseId: string | null }) => e.forkedFromExerciseId !== null),
    ).toBeDefined();
  });
});

describe("DELETE /v1/exercises/{id} (Spec 03.2 AC8, AC9)", () => {
  it("204s on an owned row, idempotent on repeat", async () => {
    // Same provisioning-order gotcha as the PATCH/fork tests above: auth
    // provisioning only creates the `user` row on the first authenticated
    // request, so the caller's id must be seeded directly rather than read
    // back via `findByAuthSub` before any request has been made.
    const exerciseRepo = new FakeExerciseRepository();
    const userRepo = new FakeUserRepository();
    const user = makeUser({ authSub: "auth0|user-123" });
    userRepo.seed(user);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      userRepository: userRepo,
    });
    const id = "018f9c8e-0000-7000-8000-000000000007";
    exerciseRepo.byId.set(id, {
      id,
      catalogKey: null,
      ownerUserId: user.id,
      name: "Mine",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const first = await app.inject({ method: "DELETE", url: `/v1/exercises/${id}`, headers: BEARER });
    expect(first.statusCode).toBe(204);
    expect(first.body).toBe("");

    const second = await app.inject({ method: "DELETE", url: `/v1/exercises/${id}`, headers: BEARER });
    expect(second.statusCode).toBe(204);
  });

  it("403 exercise-immutable on a global row", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const globalId = "018f9c8e-0000-7000-8000-000000000008";
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

    const res = await app.inject({ method: "DELETE", url: `/v1/exercises/${globalId}`, headers: BEARER });
    expect(res.statusCode).toBe(403);
    expect(res.json().type).toContain("exercise-immutable");
  });

  it("404 for an absent id", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
      headers: BEARER,
    });
    expect(res.statusCode).toBe(404);
  });

  it("401 without a token", async () => {
    const { app } = await buildTestApp();
    const res = await app.inject({
      method: "DELETE",
      url: "/v1/exercises/018f9c8e-0000-7000-8000-0000000000ff",
    });
    expect(res.statusCode).toBe(401);
  });
});

function makeExerciseRecordForGet() {
  return {
    id: "018f9c8e-0000-7000-8000-000000000006",
    catalogKey: "back-squat",
    ownerUserId: null,
    name: "Back Squat",
    modality: "weight_reps",
    primaryMuscleId: null,
    secondaryMuscleIds: [],
    equipmentId: null,
    isActive: true,
    forkedFromExerciseId: null,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
  };
}
