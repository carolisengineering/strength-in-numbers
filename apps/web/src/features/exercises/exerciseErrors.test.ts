import { describe, expect, it } from "vitest";

import { ApiError } from "../../api/problem";
import { EXERCISE_LIMIT_MESSAGE } from "../catalog/fieldErrors";
import { classifyExerciseError, exerciseErrorMessage, type ExerciseErrorKind } from "./exerciseErrors";

const problem = (status: number, slug: string, detail = "Test problem") =>
  new ApiError({ status, type: `https://api.strengthinnumbers.app/problems/${slug}`, title: slug, detail, requestId: "req" });
const network = new ApiError({ status: 0, type: "about:blank", title: "Network error", requestId: "req", isNetworkError: true });

describe("18.2 AC42 — classifyExerciseError", () => {
  it.each<[string, unknown, ExerciseErrorKind]>([
    ["409 exercise-type-locked", problem(409, "exercise-type-locked"), "type-locked"],
    ["409 exercise-limit-reached", problem(409, "exercise-limit-reached"), "limit"],
    ["409 exercise-retired", problem(409, "exercise-retired"), "gone"],
    ["404", problem(404, "not-found"), "gone"],
    ["409 exercise-immutable-use-fork", problem(409, "exercise-immutable-use-fork"), "built-in"],
    ["403 exercise-immutable", problem(403, "exercise-immutable"), "built-in"],
    ["422", problem(422, "validation-error"), "validation"],
    ["network", network, "network"],
    ["429", problem(429, "rate-limited"), "rate-limited"],
    ["401", problem(401, "unauthenticated"), "unauthenticated"],
    ["500", problem(500, "internal"), "server"],
    ["503", problem(503, "unavailable"), "server"],
    ["409 unknown slug", problem(409, "something-else"), "unknown"],
    ["403 other slug", problem(403, "forbidden"), "unknown"],
    ["a TypeError", new TypeError("boom"), "unknown"],
  ])("%s", (_label, error, kind) => {
    expect(classifyExerciseError(error)).toBe(kind);
  });

  it("keys on the slug, never the detail", () => {
    expect(classifyExerciseError(problem(409, "exercise-type-locked", "The exercise limit was reached"))).toBe("type-locked");
    expect(classifyExerciseError(problem(409, "exercise-limit-reached", "type locked"))).toBe("limit");
  });
});

describe("18.2 AC42 / AC45 — the messages", () => {
  it("gone depends on the operation", () => {
    expect(exerciseErrorMessage("gone", "update")).toBe("This exercise was already deleted.");
    expect(exerciseErrorMessage("gone", "delete")).toBe("This exercise was already deleted.");
    expect(exerciseErrorMessage("gone", "fork")).toBe("This exercise is no longer available.");
  });

  it("the rest of the table", () => {
    expect(exerciseErrorMessage("limit", "fork")).toBe(EXERCISE_LIMIT_MESSAGE);
    expect(EXERCISE_LIMIT_MESSAGE).toBe("You've reached the maximum number of custom exercises.");
    expect(exerciseErrorMessage("built-in", "update")).toBe("This is a built-in exercise, so it can't be edited. Make your own copy instead.");
    expect(exerciseErrorMessage("network", "update")).toBe("You're offline. Editing an exercise needs a connection.");
    expect(exerciseErrorMessage("rate-limited", "delete")).toBe("You're doing that too fast. Try again in a moment.");
    expect(exerciseErrorMessage("unauthenticated", "update")).toBeNull();
    for (const kind of ["server", "unknown", "validation", "type-locked"] as const) {
      expect(exerciseErrorMessage(kind, "update")).toBe("Couldn't save. Try again.");
    }
  });
});
