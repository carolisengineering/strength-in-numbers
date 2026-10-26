import { describe, expect, it } from "vitest";
import { buildTestApp } from "../helpers/build-test-app.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

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
