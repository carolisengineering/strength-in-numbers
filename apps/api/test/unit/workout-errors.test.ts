import { describe, expect, it } from "vitest";
import {
  IncompleteWorkingSetsError,
  WorkoutFinishedError,
  WorkoutInProgressExistsError,
} from "../../src/errors/app-error.js";

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
