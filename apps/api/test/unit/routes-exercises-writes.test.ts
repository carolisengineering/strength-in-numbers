import { describe, it, expect } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, fakeVerifier } from "../helpers/fakes.js";
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
