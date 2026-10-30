import { pino } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { IncompleteWorkingSetsError, WorkoutFinishedError } from "../../src/errors/app-error.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { settleOneOff } from "../../src/repositories/routine-one-off.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import type { RoutineCreateFields } from "../../src/repositories/routine.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";
import { insertExercise, insertUser, recordsOf, type RecordRow } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

const FAULT_FN = `CREATE OR REPLACE FUNCTION one_off_test_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected one-off fault'; END $$`;
const ROUTINE_FAULT = `CREATE TRIGGER one_off_test_fault AFTER DELETE ON "routine" FOR EACH ROW EXECUTE FUNCTION one_off_test_fault()`;
const PR_FAULT = `CREATE TRIGGER one_off_test_fault BEFORE INSERT ON "personal_record" FOR EACH ROW EXECUTE FUNCTION one_off_test_fault()`;

describe.skipIf(!shouldRunIntegration())("Spec 09.3 — the finish removes or keeps the one-off (real Postgres)", () => {
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
    await db.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS one_off_test_fault ON "routine"`);
    await db.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS one_off_test_fault ON "personal_record"`);
    await assertSectionsConsistent(db);
    await assertDerivedColumnsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const x = (sql: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(sql, ...args);
  const now = () => new Date().toISOString();
  const exists = async (id: string) => (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "routine" WHERE id = $1::uuid`, id))[0]!.n === 1;
  /** The routine row (minus nothing) and every child row, as one text: "byte-identical" checks. */
  const routineSnapshot = async (id: string) =>
    JSON.stringify(
      await q(
        `SELECT (SELECT to_jsonb(r) FROM "routine" r WHERE r.id = $1::uuid) AS routine,
           (SELECT json_agg(to_jsonb(i) ORDER BY i.position) FROM "routine_item" i WHERE i.routine_id = $1::uuid) AS items,
           (SELECT json_agg(to_jsonb(s) ORDER BY s.position) FROM "routine_section" s WHERE s.routine_id = $1::uuid) AS sections,
           (SELECT json_agg(to_jsonb(p) ORDER BY p.id) FROM "routine_item_set" p
              JOIN "routine_item" i ON i.id = p.routine_item_id WHERE i.routine_id = $1::uuid) AS sets`,
        id,
      ),
    );
  const childCount = async (id: string) =>
    (
      await q<{ n: number }>(
        `SELECT ((SELECT count(*) FROM "routine_item" WHERE routine_id = $1::uuid)
              + (SELECT count(*) FROM "routine_section" WHERE routine_id = $1::uuid)
              + (SELECT count(*) FROM "routine_item_set" p JOIN "routine_item" i ON i.id = p.routine_item_id WHERE i.routine_id = $1::uuid))::int AS n`,
        id,
      )
    )[0]!.n;

  /** Two sections, three items with planned sets. */
  const doc = (ex: string, name: string, oneOff: boolean): RoutineCreateFields => ({
    ...(oneOff ? { oneOff: true as const } : {}),
    name,
    notes: "routine notes",
    sections: [
      { key: "a", name: "Strength", notes: "heavy" },
      { key: "b", name: "Finisher" },
    ],
    items: [
      { exerciseId: ex, sectionKey: "a", sets: [{ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }] },
      { exerciseId: ex, sectionKey: "a", sets: [{ setType: "working", repsLow: 8, repsHigh: 10 }] },
      { exerciseId: ex, sectionKey: "b", targetSets: 2, targetRepsLow: 12, targetRepsHigh: 15 },
    ],
  });

  /** Start from the routine and log one complete working set per exercise. */
  async function startAndLog(u: string, routineId: string | undefined, key = uuidv7(), weight = 100) {
    const { workout } = await workouts().createWorkout(
      u,
      { clientGeneratedId: key, startedAt: new Date(Date.now() - 3_600_000), tzOffsetMinutes: 0, title: null, notes: null, routineId },
      "UTC",
    );
    const detail = await workouts().getWorkoutById(u, workout.id);
    for (const e of detail.exercises) {
      await workouts().createSet(u, e.id, { reps: 5, weight, weightUnit: "kg", isComplete: true });
    }
    return { workoutId: workout.id, key };
  }
  async function setup(name = "Class", oneOff = true) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u, name: "Squat", modality: "weight_reps" });
    const routine = (await routines().create(u, doc(ex, name, oneOff))).routine;
    return { u, ex, routine };
  }
  /** Holds `FOR UPDATE` on a routine row in another transaction until released. */
  async function holdRoutineLock(id: string) {
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const tx = db.prisma.$transaction(
      async (t) => {
        await t.$queryRawUnsafe(`SELECT id FROM "routine" WHERE id = $1::uuid FOR UPDATE`, id);
        locked();
        await released;
      },
      { timeout: 30_000 },
    );
    await isLocked;
    return async () => {
      release();
      await tx;
    };
  }
  /** Rejects if `p` has not settled within `ms` — a lock wait would hit it. */
  const within = <T>(p: Promise<T>, ms = 3_000) =>
    Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`still waiting after ${ms} ms`)), ms))]);
  const minus = (o: object, keys: string[]) => {
    const copy: Record<string, unknown> = { ...o };
    for (const k of keys) delete copy[k];
    return copy;
  };

  describe("09.3 AC12 — the finish removes the one-off", () => {
    it("deletes the routine and its children in the finish; the workout reads exactly as before", async () => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      const before = await workouts().getWorkoutById(u, workoutId);
      expect(before.routineIsOneOff).toBe(true);
      // A minute ahead (inside the future-skew bound) so the finish clamps no set time (07.4 AC25).
      const result = await workouts().updateWorkout(u, workoutId, { endedAt: new Date(Date.now() + 60_000).toISOString() });
      expect(result.oneOff).toBe("removed");
      expect(await exists(routine.id)).toBe(false);
      expect(await childCount(routine.id)).toBe(0);
      expect((await q<{ r: string | null }>(`SELECT routine_id::text AS r FROM "workout" WHERE id = $1::uuid`, workoutId))[0]!.r).toBeNull();
      const after = await workouts().getWorkoutById(u, workoutId);
      expect(after.routineIsOneOff).toBe(false);
      const drop = ["endedAt", "updatedAt", "routineIsOneOff"];
      expect(JSON.parse(JSON.stringify(minus(after, drop)))).toEqual(JSON.parse(JSON.stringify(minus(before, drop))));
      expect(after.routineName).toBe("Class");
      expect(after.sections.map((s) => s.name)).toEqual(["Strength", "Finisher"]);
    });

    it("the finish result equals that of the same finish from an ordinary routine", async () => {
      const one = await setup("Class", true);
      const ord = await setup("Class", false);
      const a = await startAndLog(one.u, one.routine.id);
      const b = await startAndLog(ord.u, ord.routine.id);
      const ra = await workouts().updateWorkout(one.u, a.workoutId, { endedAt: now() });
      const rb = await workouts().updateWorkout(ord.u, b.workoutId, { endedAt: now() });
      expect(Object.keys(ra).sort()).toEqual(Object.keys(rb).sort());
      expect(Object.keys(ra.workout).sort()).toEqual(Object.keys(rb.workout).sort());
      const shape = (r: typeof ra) => r.newRecords.map((x) => [x.recordType, x.value, x.unit]).sort();
      expect(shape(ra)).toEqual(shape(rb));
      expect(ra.workout.routineName).toBe(rb.workout.routineName);
      expect([ra.oneOff, rb.oneOff]).toEqual(["removed", "none"]);
    });
  });

  describe("09.3 AC13 — the finish with keepRoutine keeps it", () => {
    it("clears the mark, bumps updated_at, leaves the children; the routine is then ordinary", async () => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      const children = await q(`SELECT count(*)::int AS n FROM "routine_item" WHERE routine_id = $1::uuid`, routine.id);
      const before = (await q<{ updated_at: Date }>(`SELECT updated_at FROM "routine" WHERE id = $1::uuid`, routine.id))[0]!;
      const result = await workouts().updateWorkout(u, workoutId, { endedAt: now(), keepRoutine: true });
      expect(result.oneOff).toBe("kept");
      const row = (await q<{ one_off_until: Date | null; updated_at: Date }>(`SELECT one_off_until, updated_at FROM "routine" WHERE id = $1::uuid`, routine.id))[0]!;
      expect(row.one_off_until).toBeNull();
      expect(row.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      expect(await q(`SELECT count(*)::int AS n FROM "routine_item" WHERE routine_id = $1::uuid`, routine.id)).toEqual(children);
      expect(await childCount(routine.id)).toBeGreaterThan(0);
      expect(((await routines().list(u)).routines).map((r) => [r.id, r.oneOffUntil])).toEqual([[routine.id, null]]);
    });
  });

  describe("09.3 AC14 — everything else is unaffected", () => {
    it("manual, ordinary, hand-deleted and kept-elsewhere finishes change no routine, keepRoutine or not", async () => {
      const { u, ex } = await setup("unused", false);
      const ordinary = (await routines().create(u, doc(ex, "Ordinary", false))).routine;
      const routineTable = async () => JSON.stringify(await q(`SELECT to_jsonb(r) FROM "routine" r ORDER BY id`));

      for (const keepRoutine of [true, undefined]) {
        const before = await routineTable();
        const manual = await startAndLog(u, undefined);
        expect((await workouts().updateWorkout(u, manual.workoutId, { endedAt: now(), keepRoutine })).oneOff).toBe("none");
        const fromOrdinary = await startAndLog(u, ordinary.id);
        expect((await workouts().updateWorkout(u, fromOrdinary.workoutId, { endedAt: now(), keepRoutine })).oneOff).toBe("none");
        expect(await routineTable()).toBe(before);
      }

      const gone = (await routines().create(u, doc(ex, "Gone", true))).routine;
      const w1 = await startAndLog(u, gone.id);
      await routines().delete(u, gone.id);
      expect((await workouts().updateWorkout(u, w1.workoutId, { endedAt: now() })).oneOff).toBe("none");

      const keptElsewhere = (await routines().create(u, doc(ex, "Kept elsewhere", true))).routine;
      const w2 = await startAndLog(u, keptElsewhere.id);
      await routines().keep(u, keptElsewhere.id);
      const snap = await routineSnapshot(keptElsewhere.id);
      expect((await workouts().updateWorkout(u, w2.workoutId, { endedAt: now(), keepRoutine: true })).oneOff).toBe("none");
      expect(await routineSnapshot(keptElsewhere.id)).toBe(snap);
    });

    it("settleOneOff never removes or keeps an ordinary routine", async () => {
      const { u, routine } = await setup("Ordinary", false);
      const snap = await routineSnapshot(routine.id);
      expect(await db.prisma.$transaction((tx) => settleOneOff(tx, u, routine.id, false))).toBe("none");
      expect(await db.prisma.$transaction((tx) => settleOneOff(tx, u, routine.id, true))).toBe("none");
      expect(await routineSnapshot(routine.id)).toBe(snap);
    });

    it("an ordinary routine locked elsewhere does not block the finish", async () => {
      const { u, routine } = await setup("Ordinary", false);
      const { workoutId } = await startAndLog(u, routine.id);
      const release = await holdRoutineLock(routine.id);
      try {
        expect((await within(workouts().updateWorkout(u, workoutId, { endedAt: now() }))).oneOff).toBe("none");
      } finally {
        await release();
      }
    });
  });

  describe("09.3 AC15 — atomic with the finish", () => {
    it("an incomplete working set: 409, the workout stays live and the one-off intact", async () => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      const card = (await workouts().getWorkoutById(u, workoutId)).exercises[0]!;
      await workouts().createSet(u, card.id, { reps: null, weight: 100, weightUnit: "kg", isComplete: false });
      const snap = await routineSnapshot(routine.id);
      await expect(workouts().updateWorkout(u, workoutId, { endedAt: now() })).rejects.toBeInstanceOf(IncompleteWorkingSetsError);
      expect((await workouts().getWorkoutById(u, workoutId)).endedAt).toBeNull();
      expect(await routineSnapshot(routine.id)).toBe(snap);
    });

    it.each([
      ["a failure after the routine delete", ROUTINE_FAULT],
      ["a failing record recompute", PR_FAULT],
    ])("%s rolls back both", async (_label, trigger) => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      const snap = await routineSnapshot(routine.id);
      await x(FAULT_FN);
      await x(trigger);
      await expect(workouts().updateWorkout(u, workoutId, { endedAt: now() })).rejects.toThrow(/injected one-off fault/);
      expect((await workouts().getWorkoutById(u, workoutId)).endedAt).toBeNull();
      expect(await routineSnapshot(routine.id)).toBe(snap);
    });
  });

  describe("09.3 AC16 — a re-finish does nothing to routines", () => {
    it("a keepRoutine re-finish is 409 and does not rescue the removed routine", async () => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      await expect(workouts().updateWorkout(u, workoutId, { endedAt: now(), keepRoutine: true })).rejects.toBeInstanceOf(WorkoutFinishedError);
      expect(await exists(routine.id)).toBe(false);
    });

    it("a finished workout still pointing at a one-off (data repair): the re-finish takes no routine lock and writes no routine", async () => {
      const { u, ex, routine } = await setup();
      const { workoutId } = await startAndLog(u, undefined);
      await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      await x(`UPDATE "workout" SET routine_id = $2::uuid WHERE id = $1::uuid`, workoutId, routine.id);
      const snap = await routineSnapshot(routine.id);
      const release = await holdRoutineLock(routine.id);
      const seen = await startCapture(db);
      try {
        await expect(within(workouts().updateWorkout(u, workoutId, { endedAt: now(), keepRoutine: true }))).rejects.toBeInstanceOf(WorkoutFinishedError);
      } finally {
        await release();
      }
      await settleCapture(db, seen);
      expect(seen.join("\n")).not.toMatch(/DELETE FROM "routine"|UPDATE "routine"/);
      expect(await routineSnapshot(routine.id)).toBe(snap);
      expect(ex).toBeTruthy();
    });
  });

  describe("09.3 AC17 — only a finish touches the routine", () => {
    it("start, PATCH, Change Time, set and exercise writes and a discard leave the one-off byte-identical", async () => {
      const { u, ex, routine } = await setup();
      const snap = await routineSnapshot(routine.id);
      const same = async () => expect(await routineSnapshot(routine.id)).toBe(snap);
      const { workoutId } = await startAndLog(u, routine.id);
      await same();
      await workouts().updateWorkout(u, workoutId, { title: "Tuesday", notes: "felt good" });
      await same();
      await workouts().updateWorkout(u, workoutId, { startedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() });
      await same();
      const card = (await workouts().getWorkoutById(u, workoutId)).exercises[0]!;
      const { set } = await workouts().createSet(u, card.id, { reps: 3, weight: 90, weightUnit: "kg", isComplete: true });
      await workouts().updateSet(u, set.id, { reps: 4 });
      await workouts().deleteSet(u, set.id);
      await same();
      const added = await workouts().addWorkoutExercise(u, workoutId, { exerciseId: ex });
      await workouts().updateWorkoutExercise(u, added.id, { position: 0 });
      await workouts().deleteWorkoutExercise(u, added.id);
      await same();
      await workouts().deleteWorkout(u, workoutId);
      await same();
      const again = await startAndLog(u, routine.id);
      expect((await workouts().getWorkoutById(u, again.workoutId)).routineIsOneOff).toBe(true);
    });

    it("a finished-workout set edit leaves an unrelated one-off untouched", async () => {
      const { u, ex, routine } = await setup();
      const ordinary = (await routines().create(u, doc(ex, "Ordinary", false))).routine;
      const { workoutId } = await startAndLog(u, ordinary.id);
      await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      const snap = await routineSnapshot(routine.id);
      const card = (await workouts().getWorkoutById(u, workoutId)).exercises[0]!;
      await workouts().updateSet(u, card.sets[0]!.id, { reps: 6 });
      expect(await routineSnapshot(routine.id)).toBe(snap);
    });
  });

  describe("09.3 AC18 — History and records are indifferent", () => {
    it("records, the History row and newRecords equal an ordinary-routine control run, before and after a rebuild", async () => {
      const one = await setup("Class", true);
      const ord = await setup("Class", false);
      const a = await startAndLog(one.u, one.routine.id, uuidv7(), 120);
      const b = await startAndLog(ord.u, ord.routine.id, uuidv7(), 120);
      const ra = await workouts().updateWorkout(one.u, a.workoutId, { endedAt: now() });
      const rb = await workouts().updateWorkout(ord.u, b.workoutId, { endedAt: now() });
      const shape = (rows: RecordRow[]) =>
        rows.map((r) => [r.record_type, r.value, r.unit, r.previous_value]).sort();
      expect(shape(await recordsOf(db, one.u))).toEqual(shape(await recordsOf(db, ord.u)));
      expect(ra.newRecords.map((r) => r.recordType).sort()).toEqual(rb.newRecords.map((r) => r.recordType).sort());
      const row = async (u: string) => (await workouts().listFinishedWorkouts(u, { limit: 5 })).items[0]!;
      expect((await row(one.u)).routineName).toBe((await row(ord.u)).routineName);
      const beforeRebuild = shape(await recordsOf(db, one.u));
      await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: one.u });
      expect(shape(await recordsOf(db, one.u))).toEqual(beforeRebuild);
    });
  });

  describe("09.3 AC24 — one lock order", () => {
    it("PR lock → routine lock → workout FOR UPDATE → … → routine delete, the delete after the recompute", async () => {
      const { u, routine } = await setup();
      const { workoutId } = await startAndLog(u, routine.id);
      const seen = await startCapture(db);
      await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      await settleCapture(db, seen);
      const at =(test: (s: string) => boolean) => seen.findIndex(test);
      const prLock = at((s) => s.includes("pg_advisory_xact_lock(hashtext("));
      const routineLock = at((s) => s.includes(`FROM "routine" r`) && /FOR UPDATE/.test(s));
      const workoutLock = at((s) => s.includes(`FROM "workout"`) && /FOR UPDATE/.test(s) && !s.includes(`FROM "routine" r`));
      const routineDelete = at((s) => s.includes(`DELETE FROM "routine"`));
      const lastRecompute = seen.reduce((last, s, i) => (s.includes(`"personal_record"`) ? i : last), -1);
      expect(prLock).toBeGreaterThanOrEqual(0);
      expect([prLock < routineLock, routineLock < workoutLock, workoutLock < routineDelete]).toEqual([true, true, true]);
      expect(routineDelete).toBeGreaterThan(lastRecompute);
    });
  });

  describe("09.3 Review Focus 3 — a start replay after the finish removed the one-off", () => {
    it("answers the stored workout, never a 404", async () => {
      const { u, routine } = await setup();
      const { workoutId, key } = await startAndLog(u, routine.id);
      await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      const replay = await workouts().createWorkout(
        u,
        { clientGeneratedId: key, startedAt: new Date(Date.now() - 3_600_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id },
        "UTC",
      );
      expect(replay.created).toBe(false);
      expect(replay.workout.id).toBe(workoutId);
    });
  });

  describe("09.3 Review Focus 4 — the finish removes a maximal one-off", () => {
    it("30 items × 20 planned sets in 8 sections: 200 and no child row left", async () => {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u, modality: "weight_reps" });
      const sections = Array.from({ length: 8 }, (_, i) => ({ key: `s${i}`, name: `Section ${i}` }));
      const items = Array.from({ length: 30 }, (_, i) => ({
        exerciseId: ex,
        sectionKey: `s${Math.min(7, Math.floor(i / 4))}`,
        sets: Array.from({ length: 20 }, () => ({ setType: "working" as const, repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" as const })),
      }));
      const routine = (await routines().create(u, { name: "Max", oneOff: true, sections, items })).routine;
      const { workoutId } = await workouts()
        .createWorkout(u, { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 3_600_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id }, "UTC")
        .then((r) => ({ workoutId: r.workout.id }));
      const result = await workouts().updateWorkout(u, workoutId, { endedAt: now() });
      expect(result.oneOff).toBe("removed");
      expect(await childCount(routine.id)).toBe(0);
      expect(await exists(routine.id)).toBe(false);
    });
  });
});
