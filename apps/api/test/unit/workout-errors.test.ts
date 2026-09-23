import { describe, expect, it } from "vitest";
import { WorkoutFinishedError, WorkoutInProgressExistsError } from "../../src/errors/app-error.js";

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
