import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AccountExportSchema, ExerciseSchema, MeSchema, RoutineItemSchema, RoutineSchema, RoutineSectionSchema, SetEntrySchema, WorkoutExerciseSchema, WorkoutSchema, WorkoutSectionSchema } from "@sin/core";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, logWorkout } from "./records-helpers.js";
import { routineFixture } from "./routine-helpers.js";
import { bearer, makeAccountApp, TRUNCATE_ACCOUNTS } from "./account-helpers.js";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

describe.skipIf(!shouldRunIntegration())("Spec 11 — GET /v1/account/export (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance | undefined;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ACCOUNTS);
  });

  async function me(token: string): Promise<{ id: string } & Record<string, unknown>> {
    return (await app!.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).json();
  }
  async function exportOf(token: string) {
    const res = await app!.inject({ method: "GET", url: "/v1/account/export", headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    return res;
  }

  /** A user owning one of everything, incl. an lb set, RPE 8.5 and a routine-started workout. */
  async function seed(token: string) {
    const { id } = await me(token);
    const global = await insertExercise(db);
    const custom = await insertExercise(db, { ownerUserId: id, name: "Custom" });
    const routine = await createRoutineRepository(db.prisma).create(
      id,
      routineFixture([custom, global], {
        notes: "Routine note\r\nsecond line",
        sections: [{ key: "main", name: "Main", notes: "Heavy singles" }],
        sectionKeys: ["main", "main"],
      }),
    );
    const w1 = await logWorkout(db, id, { startedAt: daysAgo(3), exercises: [{ exerciseId: custom, sets: [{ reps: 5, weight: 225, weightUnit: "lb" }] }] });
    await db.prisma.$executeRawUnsafe(`UPDATE "set_entry" SET rpe = 8.5 WHERE id = $1::uuid`, w1.setIds[0]![0]);
    const started = await app!.inject({
      method: "POST", url: "/v1/workouts",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: { clientGeneratedId: crypto.randomUUID(), startedAt: new Date().toISOString(), routineId: routine.id },
    });
    expect(started.statusCode).toBe(201);
    return { id, global, custom, routine, w1, activeId: started.json().id as string };
  }

  it("AC2 — envelope, exportedAt near now, profile equals GET /v1/me minus isNewUser", async () => {
    app = await makeAccountApp(db);
    const profile = await me("exp-a");
    const body = (await exportOf("exp-a")).json();
    expect(body.formatVersion).toBe(1);
    expect(Math.abs(Date.parse(body.exportedAt) - Date.now())).toBeLessThan(30_000);
    const expected: Record<string, unknown> = { ...profile };
    delete expected.isNewUser;
    expect(body.profile).toEqual(expected);
  });

  it("AC4 — every object's keys are a DTO key set; no authSub / deletedAt / global exercise / personal_record", async () => {
    app = await makeAccountApp(db);
    const s = await seed("exp-a");
    const body = (await exportOf("exp-a")).json();
    const keys = (o: object) => Object.keys(o).sort();
    const shape = (schema: { shape: object }) => Object.keys(schema.shape).sort();
    expect(keys(body.profile)).toEqual(shape(MeSchema).filter((k) => k !== "isNewUser"));
    for (const e of body.exercises) expect(keys(e)).toEqual(shape(ExerciseSchema));
    for (const r of body.routines) {
      expect(keys(r)).toEqual(shape(RoutineSchema));
      for (const i of r.items) expect(keys(i)).toEqual(shape(RoutineItemSchema));
      for (const s of r.sections) expect(keys(s)).toEqual(shape(RoutineSectionSchema));
    }
    for (const w of body.workouts) {
      expect(keys(w)).toEqual([...shape(WorkoutSchema), "exercises", "routineNotes", "sections"].sort());
      for (const s of w.sections) expect(keys(s)).toEqual(shape(WorkoutSectionSchema));
      for (const e of w.exercises) {
        expect(keys(e)).toEqual([...shape(WorkoutExerciseSchema), "sets"].sort());
        for (const x of e.sets) expect(keys(x)).toEqual(shape(SetEntrySchema));
      }
    }
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/authSub|deletedAt|emailVerified/);
    expect(body.exercises.map((e: { id: string }) => e.id)).toEqual([s.custom]);
  });

  it("AC24 — the export carries sections, sectionId and routineNotes on both sides, equal to the read routes", async () => {
    app = await makeAccountApp(db);
    const s = await seed("exp-a");
    const body = AccountExportSchema.parse((await exportOf("exp-a")).json());
    const routine = body.routines.find((r) => r.id === s.routine.id)!;
    expect(routine.sections.map((x) => x.name)).toEqual(["Main"]);
    expect(routine.items.every((i) => i.sectionId === routine.sections[0]!.id)).toBe(true);
    const active = body.workouts.find((w) => w.id === s.activeId)!;
    expect(active.routineNotes).toBe("Routine note\r\nsecond line");
    expect(active.sections.map((x) => [x.name, x.notes])).toEqual([["Main", "Heavy singles"]]);
    expect(active.exercises.every((e) => e.sectionId === active.sections[0]!.id)).toBe(true);
    const read = await app.inject({ method: "GET", url: `/v1/workouts/${s.activeId}`, headers: bearer("exp-a") });
    expect(active).toEqual(read.json()); // Spec 11 AC6 parity, with section rows present
  });

  it("AC6 — parity: each workout, routine and exercise deep-equals its read route", async () => {
    app = await makeAccountApp(db);
    await seed("exp-a");
    const body = AccountExportSchema.parse((await exportOf("exp-a")).json());
    for (const w of body.workouts) {
      const read = await app.inject({ method: "GET", url: `/v1/workouts/${w.id}`, headers: bearer("exp-a") });
      expect(w).toEqual(read.json());
    }
    for (const r of body.routines) {
      const read = await app.inject({ method: "GET", url: `/v1/routines/${r.id}`, headers: bearer("exp-a") });
      expect(r).toEqual(read.json());
    }
    const catalog = (await app.inject({ method: "GET", url: "/v1/exercises", headers: bearer("exp-a") })).json();
    for (const e of body.exercises) {
      expect(e).toEqual(catalog.exercises.find((c: { id: string }) => c.id === e.id));
    }
    const lb = body.workouts.flatMap((w) => w.exercises.flatMap((e) => e.sets)).find((x) => x.weightUnit === "lb")!;
    expect(lb.rpe).toBe(8.5);
  });

  it("AC5 — two users with identically named rows each see only their own ids", async () => {
    app = await makeAccountApp(db);
    const a = await seed("exp-a");
    const b = await seed("exp-b");
    const bodyA = (await exportOf("exp-a")).json();
    const text = JSON.stringify(bodyA);
    for (const foreign of [b.id, b.custom, b.routine.id, b.w1.workoutId, b.activeId]) expect(text).not.toContain(foreign);
    for (const own of [a.custom, a.routine.id, a.w1.workoutId, a.activeId]) expect(text).toContain(own);
  });

  it("Review Focus 5 — an export in flight when the delete lands returns the full snapshot", async () => {
    app = await makeAccountApp(db);
    const a = await seed("exp-a");
    const [exp, del] = await Promise.all([
      app.inject({ method: "GET", url: "/v1/account/export", headers: bearer("exp-a") }),
      app.inject({ method: "DELETE", url: "/v1/account", headers: bearer("exp-a") }),
    ]);
    expect(del.statusCode).toBe(202);
    // Either order is legal: export first → full 200; delete first → 403.
    if (exp.statusCode === 200) expect(JSON.stringify(exp.json())).toContain(a.w1.workoutId);
    else expect(exp.statusCode).toBe(403);
  });

  it("AC12 — heavy account: 400 workouts / 8,000 sets / 50 routines / 500 exercises in < 10 s", async () => {
    app = await makeAccountApp(db);
    const { id } = await me("exp-heavy");
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "exercise" (id, owner_user_id, name, modality, is_active)
       SELECT gen_random_uuid(), $1::uuid, 'Custom ' || g, 'weight_reps', true FROM generate_series(1, 500) g`, id);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine" (id, user_id, name) SELECT gen_random_uuid(), $1::uuid, 'Routine ' || g FROM generate_series(1, 50) g`, id);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "routine_item" (id, routine_id, position, exercise_id)
       SELECT gen_random_uuid(), r.id, 0, (SELECT id FROM "exercise" WHERE owner_user_id = $1::uuid ORDER BY id LIMIT 1)
       FROM "routine" r WHERE r.user_id = $1::uuid`, id);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout" (id, user_id, started_at, ended_at, local_date, tz_offset_minutes, client_generated_id)
       SELECT gen_random_uuid(), $1::uuid, now() - g * interval '1 day', now() - g * interval '1 day' + interval '1 hour',
              (now() - g * interval '1 day')::date, 0, gen_random_uuid()
       FROM generate_series(1, 400) g`, id);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot)
       SELECT gen_random_uuid(), w.id, p, (SELECT id FROM "exercise" WHERE owner_user_id = $1::uuid ORDER BY id LIMIT 1), 'Bench', 'weight_reps'
       FROM "workout" w, generate_series(0, 3) p WHERE w.user_id = $1::uuid`, id);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "set_entry" (id, workout_exercise_id, set_number, set_type, reps, weight, weight_unit, is_complete)
       SELECT gen_random_uuid(), we.id, s, 'working', 5, 100, 'kg', true
       FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id, generate_series(1, 5) s
       WHERE w.user_id = $1::uuid`, id);
    const t0 = Date.now();
    const body = (await exportOf("exp-heavy")).json();
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(body.workouts).toHaveLength(400);
    expect(body.exercises).toHaveLength(500);
    expect(body.routines).toHaveLength(50);
  });
});
