import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const EX = makeExerciseRecord({ name: "Bench" });

describe("AC28 — workout_started_from_routine carries section_count and no text", () => {
  it("logs the count only", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const { app } = await buildTestApp({
      logger, exerciseRepository: exerciseRepo, routineRepository: routineRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo, routineRepo), rateLimits: GENEROUS_LIMITS,
    });
    const routine = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: {
      name: "distinctive-routine-qzx", notes: "distinctive-routine-note-wvu",
      sections: [{ key: "a", name: "distinctive-section-tsr", notes: "distinctive-section-note-pon" }, { key: "b", name: "B" }],
      items: [{ exerciseId: EX.id, sectionKey: "a", notes: "distinctive-item-note-mlk" }],
    } })).json();
    const res = await app.inject({ method: "POST", url: "/v1/workouts", headers: BEARER, payload: {
      clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000).toISOString(), routineId: routine.id,
    } });
    expect(res.statusCode).toBe(201);
    const line = lines.find((l) => l.msg === "workout_started_from_routine")!;
    expect(line).toMatchObject({ item_count: 1, section_count: 2 });
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-/);
  });
});
