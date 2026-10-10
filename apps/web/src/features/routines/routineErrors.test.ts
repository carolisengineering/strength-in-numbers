import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../api";
import { reportRoutineUnexpected } from "./reportRoutine";
import { classifyRoutineError } from "./routineErrors";

afterEach(() => observability.reportError.mockReset());

const problem = (status: number, type: string, errors: { path: string; message: string }[] = []) =>
  new ApiError({ status, type: `https://strengthinnumbers.app/problems/${type}`, title: "t", requestId: "req-1", errors });

describe("10.0 AC11 — classifyRoutineError", () => {
  it.each([
    [problem(409, "routine-name-taken"), "name-taken"],
    [problem(409, "routine-limit"), "limit"],
    [problem(409, "exercise-retired"), "retired"],
    [problem(409, "something-new"), "unknown"],
    [problem(422, "validation-error"), "validation"],
    [problem(404, "not-found"), "not-found"],
    [problem(429, "rate-limited"), "rate-limited"],
    [problem(401, "invalid-token"), "unauthenticated"],
    [problem(503, "auth-unavailable"), "server"],
    [problem(418, "teapot"), "unknown"],
    [ApiError.network("req-n", new TypeError("offline")), "network"],
    [new Error("boom"), "unknown"],
    ["nope", "unknown"],
  ])("%s → %s", (error, kind) => {
    expect(classifyRoutineError(error).kind).toBe(kind);
  });

  it("keys on the slug, never the title text", () => {
    const misleading = new ApiError({ status: 409, type: "https://x/problems/routine-limit", title: "routine-name-taken", requestId: "r" });
    expect(classifyRoutineError(misleading).kind).toBe("limit");
  });

  it("parses retired item indexes from errors[].path and carries the request id", () => {
    const err = problem(409, "exercise-retired", [
      { path: "items.3.exerciseId", message: "retired" },
      { path: "items.0.exerciseId", message: "retired" },
      { path: "routineId", message: "retired" },
    ]);
    expect(classifyRoutineError(err)).toMatchObject({ kind: "retired", retiredIndexes: [3, 0], requestId: "req-1" });
  });

  it("a start's routineId path yields no item indexes", () => {
    expect(classifyRoutineError(problem(409, "exercise-retired", [{ path: "routineId", message: "x" }])).retiredIndexes).toEqual([]);
  });

  it("validation carries field errors", () => {
    expect(classifyRoutineError(problem(422, "validation-error", [{ path: "name", message: "m" }])).fieldErrors).toEqual([
      { path: "name", message: "m" },
    ]);
  });
});

describe("10.0 AC11 — reportRoutineUnexpected reports unknown and validation only, with static tags", () => {
  it.each([
    [problem(418, "teapot"), true],
    [problem(422, "validation-error"), true],
    [new Error("boom"), true],
    [problem(409, "routine-name-taken"), false],
    [problem(409, "routine-limit"), false],
    [problem(404, "not-found"), false],
    [problem(429, "rate-limited"), false],
    [problem(500, "internal"), false],
    [ApiError.network("r", null), false],
  ])("%s → reported %s", (error, reported) => {
    reportRoutineUnexpected("save-routine", error);
    if (reported) expect(observability.reportError).toHaveBeenCalledWith(error, { source: "routines", op: "save-routine" });
    else expect(observability.reportError).not.toHaveBeenCalled();
  });
});
