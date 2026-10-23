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

  it("D22 — 201s (not 422) forking a curated row whose secondaryMuscleIds is already over the 4-entry cap", async () => {
    const overCapId = "018f9c8e-0000-7000-8000-000000000009";
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.muscleGroups = ["m1", "m2", "m3", "m4", "m5"].map((id) => ({
      id,
      name: id,
      displayOrder: 1,
    }));
    exerciseRepo.byId.set(overCapId, {
      id: overCapId,
      catalogKey: "over-cap-curated-row",
      ownerUserId: null,
      name: "Over Cap Curated Row",
      modality: "weight_reps",
      primaryMuscleId: null,
      secondaryMuscleIds: ["m1", "m2", "m3", "m4", "m5"],
      equipmentId: null,
      isActive: true,
      forkedFromExerciseId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${overCapId}/fork`,
      headers: JSON_HEADERS,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().secondaryMuscleIds).toEqual(["m1", "m2", "m3", "m4", "m5"]);
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

  it("201s with a JSON content-type but an empty body (clients that always send JSON headers)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    seedGlobal(exerciseRepo);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo });

    const res = await app.inject({
      method: "POST",
      url: `/v1/exercises/${globalId}/fork`,
      headers: JSON_HEADERS,
      payload: "",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().forkedFromExerciseId).toBe(globalId);
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

  it("204s with a JSON content-type but an empty body (clients that always send JSON headers)", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    const userRepo = new FakeUserRepository();
    const user = makeUser({ authSub: "auth0|user-123" });
    userRepo.seed(user);
    const { app } = await buildTestApp({
      exerciseRepository: exerciseRepo,
      userRepository: userRepo,
    });
    const id = "018f9c8e-0000-7000-8000-0000000000e1";
    exerciseRepo.byId.set(id, {
      id,
      catalogKey: null,
      ownerUserId: user.id,
      name: "Empty-body delete",
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
      method: "DELETE",
      url: `/v1/exercises/${id}`,
      headers: JSON_HEADERS,
      payload: "",
    });
    expect(res.statusCode).toBe(204);
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

/**
 * #26 — the Spec 03.2 cases that were proven only at the repository layer, now through `inject`, so a wiring
 * mistake in the route layer (the wrong error surfaced, the wrong status mapped) fails a test.
 */
describe("#26 — PATCH / fork / DELETE at the route boundary (Spec 03.2 AC4–AC8, AC11)", () => {
  const ROW_ID = "018f9c8e-0000-7000-8000-000000000101";
  const ABSENT_ID = "018f9c8e-0000-7000-8000-0000000001ff";
  /** The id provisioning gives the default auth context's user, seeded up front (see the PATCH 200 test). */
  const caller = makeUser({ authSub: "auth0|user-123" });

  function row(fields: { ownerUserId: string | null; isActive?: boolean; primaryMuscleId?: string | null }) {
    return {
      id: ROW_ID,
      catalogKey: fields.ownerUserId === null ? "row-key" : null,
      ownerUserId: fields.ownerUserId,
      name: "Row",
      modality: "weight_reps",
      primaryMuscleId: fields.primaryMuscleId ?? null,
      secondaryMuscleIds: [],
      equipmentId: null,
      isActive: fields.isActive ?? true,
      forkedFromExerciseId: null,
      createdAt: new Date("2026-09-01T00:00:00.000Z"),
      updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    };
  }

  async function appWith(seeded: ReturnType<typeof row>) {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(seeded.id, seeded);
    const userRepo = new FakeUserRepository();
    userRepo.seed(caller);
    const { app } = await buildTestApp({ exerciseRepository: exerciseRepo, userRepository: userRepo });
    return app;
  }

  it("AC5 — PATCH on the caller's retired row → 409 exercise-retired", async () => {
    const app = await appWith(row({ ownerUserId: caller.id, isActive: false }));
    const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${ROW_ID}`, headers: JSON_HEADERS, payload: { name: "New" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-retired");
  });

  it("AC5 / #25 — PATCH on a retired global row → 409 exercise-retired, not use-fork (fork would refuse it too)", async () => {
    const app = await appWith(row({ ownerUserId: null, isActive: false }));
    const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${ROW_ID}`, headers: JSON_HEADERS, payload: { name: "New" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-retired");
  });

  it("AC5 — PATCH on an active global row is still 409 exercise-immutable-use-fork", async () => {
    const app = await appWith(row({ ownerUserId: null, isActive: true }));
    const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${ROW_ID}`, headers: JSON_HEADERS, payload: { name: "New" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-immutable-use-fork");
  });

  it("AC4 — PATCH whose merged result restates the stored primary as a secondary → 422 on secondaryMuscleIds", async () => {
    const app = await appWith(row({ ownerUserId: caller.id, primaryMuscleId: "chest" }));
    const res = await app.inject({ method: "PATCH", url: `/v1/exercises/${ROW_ID}`, headers: JSON_HEADERS, payload: { secondaryMuscleIds: ["chest"] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toContain("validation-error");
    expect(res.json().errors).toEqual([expect.objectContaining({ path: "secondaryMuscleIds" })]);
  });

  it("AC7 — fork of a retired global row → 409 exercise-retired", async () => {
    const app = await appWith(row({ ownerUserId: null, isActive: false }));
    const res = await app.inject({ method: "POST", url: `/v1/exercises/${ROW_ID}/fork`, headers: BEARER });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toContain("exercise-retired");
  });

  it("AC6 — fork whose overlay merges into an invalid row → 422 on secondaryMuscleIds", async () => {
    const app = await appWith(row({ ownerUserId: null, primaryMuscleId: "chest" }));
    const res = await app.inject({ method: "POST", url: `/v1/exercises/${ROW_ID}/fork`, headers: JSON_HEADERS, payload: { secondaryMuscleIds: ["chest"] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual([expect.objectContaining({ path: "secondaryMuscleIds" })]);
  });

  it.each([
    ["PATCH", (id: string) => `/v1/exercises/${id}`, { name: "x" }],
    ["POST", (id: string) => `/v1/exercises/${id}/fork`, undefined],
    ["DELETE", (id: string) => `/v1/exercises/${id}`, undefined],
  ] as const)("AC8 — %s on another user's row is a 404 indistinguishable from an absent id", async (method, url, payload) => {
    const app = await appWith(row({ ownerUserId: "018f9c8e-0000-7000-8000-00000000b0b0" }));
    const send = (id: string) =>
      app.inject({ method, url: url(id), headers: payload ? JSON_HEADERS : BEARER, ...(payload ? { payload } : {}) });
    const foreign = await send(ROW_ID);
    const absent = await send(ABSENT_ID);
    expect(foreign.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    // `instance` is the request id, different per request; everything else must match.
    expect({ ...foreign.json(), instance: null }).toEqual({ ...absent.json(), instance: null });
  });

  it.each([
    ["PATCH", `/v1/exercises/${ROW_ID}`],
    ["POST", `/v1/exercises/${ROW_ID}/fork`],
    ["DELETE", `/v1/exercises/${ROW_ID}`],
  ] as const)("AC11 — %s with an invalid token → 401", async (method, url) => {
    const { app } = await buildTestApp({
      tokenVerifier: fakeVerifier(() => {
        throw new InvalidTokenError("signature check failed");
      }),
    });
    const res = await app.inject({ method, url, headers: method === "PATCH" ? JSON_HEADERS : BEARER, ...(method === "PATCH" ? { payload: { name: "x" } } : {}) });
    expect(res.statusCode).toBe(401);
    expect(res.json().type).toContain("invalid-token");
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
