import { describe, expect, it } from "vitest";
import {
  IncompleteWorkingSetsError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
  WorkoutWouldBeEmptyError,
} from "../../src/errors/app-error.js";
import { toProblem } from "../../src/errors/problem.js";

describe("AC13 — IncompleteWorkingSetsError", () => {
  it("is a 409 incomplete-working-sets with a fixed public detail and no fieldErrors", () => {
    const e = new IncompleteWorkingSetsError();
    expect(e.status).toBe(409);
    expect(e.slug).toBe("incomplete-working-sets");
    expect(e.title).toBe("Working sets incomplete");
    expect(e.publicDetail).toMatch(/must be completed or removed before finishing/);
    expect(e.fieldErrors).toBeUndefined();
  });
});

describe("AC8/AC4 — workout AppError subclasses", () => {
  it("WorkoutFinishedError is a 409 with slug workout-finished", () => {
    const e = new WorkoutFinishedError();
    expect(e.status).toBe(409);
    expect(e.slug).toBe("workout-finished");
    expect(e.publicDetail).not.toContain("ended_at"); // no internal detail leaks
  });

  it("WorkoutInProgressExistsError is a 409 with slug workout-in-progress-exists", () => {
    const e = new WorkoutInProgressExistsError();
    expect(e.status).toBe(409);
    expect(e.slug).toBe("workout-in-progress-exists");
  });
});

describe("07.4 AC10 — WorkoutWouldBeEmptyError", () => {
  it("is a 409 workout-would-be-empty with a fixed title and detail", () => {
    const e = new WorkoutWouldBeEmptyError("w-1");
    expect(e.status).toBe(409);
    expect(e.slug).toBe("workout-would-be-empty");
    expect(e.title).toBe("Workout would have no sets");
    expect(e.publicDetail).toBe("This would leave the workout with no sets. Delete the whole workout instead.");
    expect(e.workoutId).toBe("w-1");
  });

  it("keeps the workout id out of the problem body (no extension member)", () => {
    expect(JSON.stringify(toProblem(new WorkoutWouldBeEmptyError("w-secret"), "req-1"))).not.toContain("w-secret");
  });
});

describe("07.4 AC3 — workout-finished narrows to a re-finish", () => {
  it("says the workout is already finished, not that it can't be modified", () => {
    expect(new WorkoutFinishedError().publicDetail).toBe("This workout has already been finished.");
  });
});
