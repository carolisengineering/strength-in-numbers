import { describe, expect, it } from "vitest";
import { TAG_KEYS, routeName } from "../src/plan/tags.ts";

const ID = "0190f6c2-3e4f-7a1b-8c2d-123456789abc";

describe("AC11 — tags are bounded", () => {
  it.each([
    ["GET", "/v1/me", "me"],
    ["GET", "/v1/exercises", "exercises"],
    ["GET", "/v1/exercises?since=1.100", "exercises"],
    ["GET", "/v1/muscle-groups", "muscle_groups"],
    ["GET", "/v1/equipment", "equipment"],
    ["GET", "/v1/routines", "routines"],
    ["GET", "/v1/workouts/active", "workout_active"],
    ["GET", "/v1/personal-records", "personal_records"],
    ["POST", "/v1/workouts", "workout_start"],
    ["POST", `/v1/workout-exercises/${ID}/sets`, "set_save"],
    ["PATCH", `/v1/workouts/${ID}`, "workout_finish"],
    ["GET", "/v1/workouts?limit=20", "history"],
    ["GET", `/v1/progress/exercises/${ID}`, "progress"],
    ["GET", "/healthz", "warmup_healthz"],
  ])("%s %s → %s", (method, path, name) => {
    expect(routeName(method, path)).toBe(name);
  });

  it("a real id never survives into a tag value", () => {
    for (const path of [`/v1/workout-exercises/${ID}/sets`, `/v1/workouts/${ID}`, `/v1/progress/exercises/${ID}`]) {
      expect(routeName(path.includes("sets") ? "POST" : path.includes("progress") ? "GET" : "PATCH", path)).not.toContain(ID);
    }
  });

  it("an unmapped path throws, so no untagged URL reaches k6", () => {
    expect(() => routeName("GET", "/v1/unknown")).toThrow();
    expect(() => routeName("DELETE", `/v1/workouts/${ID}`)).toThrow();
  });

  it("the tag keys are fixed", () => {
    expect([...TAG_KEYS]).toEqual(["name", "step", "phase", "target"]);
  });
});
