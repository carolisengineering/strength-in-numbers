import { describe, expect, it } from "vitest";
import { ApiError } from "../../api";
import { classifyWorkoutError, isWorkoutGone, type WorkoutErrorKind } from "./errors";

const problem = (status: number, slug: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({
    status,
    type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`,
    title: "Title",
    requestId: "req-1",
    ...extra,
  });

describe("AC2 — classifyWorkoutError", () => {
  it.each<[number, string, WorkoutErrorKind]>([
    [404, "not-found", "not-found"],
    [409, "workout-in-progress-exists", "workout-in-progress-exists"],
    [409, "workout-finished", "workout-finished"],
    [409, "incomplete-working-sets", "incomplete-working-sets"],
    [409, "exercise-retired", "exercise-retired"],
    [409, "something-else", "unknown"],
    [422, "validation-error", "validation"],
    [500, "about:blank", "server"],
    [503, "about:blank", "server"],
    [401, "about:blank", "unauthenticated"],
    [413, "about:blank", "unknown"],
  ])("status %i slug %s → %s", (status, slug, kind) => {
    expect(classifyWorkoutError(problem(status, slug), { op: "x" }).kind).toBe(kind);
  });

  it("422 passes field errors through; without errors[] it yields an empty list", () => {
    const withErrors = problem(422, "validation-error", { errors: [{ path: "weight", message: "bad" }] });
    expect(classifyWorkoutError(withErrors).fieldErrors).toEqual([{ path: "weight", message: "bad" }]);
    expect(classifyWorkoutError(problem(422, "validation-error")).fieldErrors).toEqual([]);
  });

  it("carries the request id for support correlation and echoes the operation name", () => {
    expect(classifyWorkoutError(problem(500, "about:blank"), { op: "create-set" })).toMatchObject({
      requestId: "req-1",
      op: "create-set",
    });
    expect(classifyWorkoutError(problem(500, "about:blank")).op).toBeNull();
  });

  it("a network failure is `network`", () => {
    expect(classifyWorkoutError(ApiError.network("req-2", new Error("down"))).kind).toBe("network");
  });

  it("never throws, whatever it is given", () => {
    for (const value of [new Error("x"), "string", undefined, null, 42, {}]) {
      expect(classifyWorkoutError(value)).toMatchObject({ kind: "unknown", requestId: null, fieldErrors: [] });
    }
  });

  it("the slug decides a 409's kind, never the title or detail text", () => {
    const misleading = problem(409, "exercise-retired", {
      title: "workout-finished",
      detail: "workout-finished",
    });
    expect(classifyWorkoutError(misleading).kind).toBe("exercise-retired");
  });
});

describe("18.0 AC18 — the would-be-empty slug is its own kind", () => {
  it.each<[number, string, WorkoutErrorKind]>([[409, "workout-would-be-empty", "workout-would-be-empty"]])(
    "status %i slug %s → %s",
    (status, slug, kind) => {
      expect(classifyWorkoutError(problem(status, slug)).kind).toBe(kind);
    },
  );
});

describe("10.6 AC13 — classifyWorkoutError knows the section cap", () => {
  it("409 workout-section-limit → workout-section-limit", () => {
    expect(classifyWorkoutError(problem(409, "workout-section-limit")).kind).toBe("workout-section-limit");
  });
});

describe("Minor 67 — isWorkoutGone", () => {
  it("a 404 means gone", () => expect(isWorkoutGone(problem(404, "not-found"))).toBe(true));
  it.each([
    ["a 500", problem(500, "about:blank")],
    ["a network TypeError", new TypeError("Failed to fetch")],
    ["undefined", undefined],
  ])("%s does not", (_label, error) => expect(isWorkoutGone(error)).toBe(false));
});
