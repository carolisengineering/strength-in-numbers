import { describe, expect, it } from "vitest";
import { ExerciseRetiredError, RoutineLimitError, RoutineNameTakenError } from "../../src/errors/app-error.js";
import { toProblem } from "../../src/errors/problem.js";
import { RATE_LIMITS, WRITE_GROUPS } from "../../src/plugins/rate-limit.js";
import { GENEROUS_LIMITS } from "../helpers/build-test-app.js";

describe("AC26 — the two routine errors render as problem+json with a fixed detail", () => {
  it.each([
    [new RoutineNameTakenError(), "routine-name-taken", "A routine with this name already exists."],
    [new RoutineLimitError(), "routine-limit", "You have reached the maximum number of routines."],
  ])("%s", (err, slug, detail) => {
    const { status, body } = toProblem(err, "req-1");
    expect(status).toBe(409);
    expect(body.type).toBe(`https://strengthinnumbers.app/problems/${slug}`);
    expect(body.detail).toBe(detail);
    expect(body.errors).toBeUndefined();
  });
});

describe("AC8 / AC17 — ExerciseRetiredError carries optional errors[]", () => {
  it("renders errors[] when given fieldErrors, keeps the generic detail", () => {
    const err = new ExerciseRetiredError("items.2 retired", {
      fieldErrors: [{ path: "items.2.exerciseId", message: "exercise is retired" }],
    });
    const { body } = toProblem(err, "req-1");
    expect(body.detail).toBe("This exercise has been retired and can no longer be modified.");
    expect(body.errors).toEqual([{ path: "items.2.exerciseId", message: "exercise is retired" }]);
  });
  it("the no-arg form still renders no errors[]", () => {
    expect(toProblem(new ExerciseRetiredError(), "r").body.errors).toBeUndefined();
  });
});

describe("AC25 — the routines write group", () => {
  it("RATE_LIMITS.groups.routines is 30 and WRITE_GROUPS lists it", () => {
    expect(RATE_LIMITS.groups.routines).toBe(30);
    expect(WRITE_GROUPS).toContain("routines");
    expect(GENEROUS_LIMITS.groups.routines).toBe(1_000_000);
  });
});
