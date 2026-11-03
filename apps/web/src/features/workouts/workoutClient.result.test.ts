import { describe, expect, it, vi } from "vitest";
import { WorkoutSectionSchema } from "@sin/core";
import { makeTimedSection } from "../../test/workoutFixtures";
import { createWorkoutClient } from "./workoutClient";

const section = makeTimedSection({ name: "Main" });
const api = () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(async () => undefined),
  request: vi.fn(async () => section),
});
const client = (a: ReturnType<typeof api>) => createWorkoutClient(a as unknown as Parameters<typeof createWorkoutClient>[0]);

describe("10.7 AC57 — the client speaks the 09.5 round and result routes", () => {
  it("putRoundTime PUTs exactly { seconds } to …/round-times/{round}, the id as one segment, parsed as a section", async () => {
    const a = api();
    await expect(client(a).putRoundTime("s/1", 3, 221)).resolves.toBe(section);
    expect(a.request).toHaveBeenCalledWith("/v1/workout-sections/s%2F1/round-times/3", { method: "PUT", body: { seconds: 221 }, schema: WorkoutSectionSchema });
  });

  it("deleteRoundTime DELETEs …/round-times/{round} and resolves undefined", async () => {
    const a = api();
    await expect(client(a).deleteRoundTime("s1", 2)).resolves.toBeUndefined();
    expect(a.delete).toHaveBeenCalledWith("/v1/workout-sections/s1/round-times/2");
  });

  it("putResult PUTs exactly the given result keys to …/result", async () => {
    const a = api();
    await client(a).putResult("s1", { capped: true, reps: 7 });
    expect(a.request).toHaveBeenCalledWith("/v1/workout-sections/s1/result", { method: "PUT", body: { capped: true, reps: 7 }, schema: WorkoutSectionSchema });
  });

  it("deleteResult DELETEs …/result and resolves undefined", async () => {
    const a = api();
    await expect(client(a).deleteResult("s1")).resolves.toBeUndefined();
    expect(a.delete).toHaveBeenCalledWith("/v1/workout-sections/s1/result");
  });

  it("the section schema is strict about roundTimes", () => {
    const noRounds = Object.fromEntries(Object.entries(section).filter(([k]) => k !== "roundTimes"));
    expect(WorkoutSectionSchema.safeParse(noRounds).success).toBe(false);
  });
});
