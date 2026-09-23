import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 05.0 AC6 — `local_date` is derived once, at insert time, via
 * `localDateFor`/`offsetMinutesForZone` (Task 4) against a real database
 * round-trip, and is unaffected by a later title/notes/finish PATCH. Task
 * 10's unit tests exercised this logic against a scripted mock; this proves
 * the real `date` column round-trips the derived value unchanged (no
 * timezone-shifting on the Postgres side) and that no later write path
 * recomputes it.
 */
describe.skipIf(!shouldRunIntegration())("AC6 — calendar fields (real Postgres)", () => {
  let db: IntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe('TRUNCATE "workout", "workout_exercise", "user" CASCADE');
  });

  async function insertUser(timezone = "UTC"): Promise<string> {
    const id = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "user" ("id", "auth_sub", "email", "timezone") VALUES ($1::uuid, $2, $3, $4)`,
      id,
      `auth0|${id}`,
      "u@ex.com",
      timezone,
    );
    return id;
  }

  it("an explicit east-of-UTC tzOffsetMinutes moves local_date forward across midnight", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T23:30:00.000Z"),
        tzOffsetMinutes: 120,
        title: null,
        notes: null,
      },
      "UTC",
    );
    expect(workout.localDate).toBe("2026-09-16");
    expect(workout.tzOffsetMinutes).toBe(120);
  });

  it("an explicit west-of-UTC tzOffsetMinutes keeps the same calendar day", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T23:30:00.000Z"),
        tzOffsetMinutes: -360,
        title: null,
        notes: null,
      },
      "UTC",
    );
    expect(workout.localDate).toBe("2026-09-15");
  });

  it("an absent tzOffsetMinutes falls back to the user's stored timezone, at that instant", async () => {
    const userId = await insertUser("America/New_York");
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout: beforeDst } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-03-08T06:00:00.000Z"), // EST, -300
        tzOffsetMinutes: undefined,
        title: null,
        notes: null,
      },
      "America/New_York",
    );
    expect(beforeDst.tzOffsetMinutes).toBe(-300);
    // Delete so the next create doesn't hit the one-in-progress rule.
    await repo.deleteWorkout(userId, beforeDst.id);

    const { workout: afterDst } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-03-08T08:00:00.000Z"), // EDT, -240
        tzOffsetMinutes: undefined,
        title: null,
        notes: null,
      },
      "America/New_York",
    );
    expect(afterDst.tzOffsetMinutes).toBe(-240);
  });

  it("local_date is unchanged by a title/notes PATCH and by finishing", async () => {
    const userId = await insertUser();
    const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
    const { workout } = await repo.createWorkout(
      userId,
      {
        clientGeneratedId: uuidv7(),
        startedAt: new Date("2026-09-15T10:00:00.000Z"),
        tzOffsetMinutes: 0,
        title: null,
        notes: null,
      },
      "UTC",
    );
    const afterEdit = await repo.updateWorkout(userId, workout.id, { title: "renamed", notes: "some notes" });
    expect(afterEdit.localDate).toBe(workout.localDate);

    const afterFinish = await repo.updateWorkout(userId, workout.id, {
      endedAt: "2026-09-15T11:00:00.000Z",
    });
    expect(afterFinish.localDate).toBe(workout.localDate);
  });
});
