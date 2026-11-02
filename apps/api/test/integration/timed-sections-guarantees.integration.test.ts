// Spec 09.5 AC18–AC21, AC23, AC24 — timed-section writes are replay-safe, owner-scoped, record-neutral,
// race-free against a finish, cascade with their section, and never touch supersets.
import type { SectionTimer, SetSectionResult } from "@sin/core";
import { pino } from "pino";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { AppError, NotFoundError, ValidationError } from "../../src/errors/app-error.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { settleCapture, startCapture } from "./one-off-helpers.js";
import { insertExercise, insertUser, recordsOf } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent, workoutWithSections } from "./section-helpers.js";

const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — timed-section guarantees (real Postgres)", () => {
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
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const q = <T>(sql: string, ...args: unknown[]) => db.prisma.$queryRawUnsafe<T[]>(sql, ...args);
  const setTimer = (sectionId: string, t: SectionTimer | null) =>
    db.prisma.$executeRawUnsafe(
      `UPDATE "workout_section" SET timer_format = $2, timer_round_s = $3, timer_rounds = $4, timer_cap_s = $5 WHERE id = $1::uuid`,
      sectionId,
      t?.format ?? null,
      t?.format === "set_timer" ? t.roundSeconds : null,
      t?.format === "set_timer" ? t.rounds : null,
      t && t.format !== "set_timer" ? t.capSeconds : null,
    );

  /** A workout with one section holding exercises 0 and 1 and a loose exercise 2; one complete set so a finish is legal. */
  async function fixture(opts: { timer?: SectionTimer | null; finished?: boolean } = {}) {
    const u = await insertUser(db);
    const ex = await insertExercise(db, { ownerUserId: u });
    const w = await workoutWithSections(db, u, ex, { sections: [{ name: "Main" }], exercises: [0, 0, null], finished: opts.finished ?? false });
    const sectionId = w.sectionIds[0]!;
    if (opts.timer !== null) await setTimer(sectionId, opts.timer ?? AMRAP);
    if (!opts.finished) await workouts().createSet(u, w.exerciseIds[0]!, { reps: 5, weight: 100, weightUnit: "kg", isComplete: true });
    return { u, ex, sectionId, ...w };
  }
  async function snapshot(sectionId: string) {
    return (
      await q<{ s: unknown; r: unknown }>(
        `SELECT to_jsonb(s) AS s,
                (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.round_no), '[]'::jsonb) FROM "workout_section_round" r WHERE r.workout_section_id = s.id) AS r
         FROM "workout_section" s WHERE s.id = $1::uuid`,
        sectionId,
      )
    )[0];
  }
  async function recorded(u: string, workoutId: string) {
    const s = (await workouts().getWorkoutById(u, workoutId)).sections[0]!;
    return { result: s.result, roundTimes: s.roundTimes, timer: s.timer };
  }

  describe("09.5 AC18 — each write applied twice", () => {
    type W = { name: string; seed?: (u: string, s: string) => Promise<unknown>; run: (u: string, s: string) => Promise<object>; flag: "changed" | "removed" };
    const writes: W[] = [
      { name: "PUT round", run: (u, s) => workouts().setSectionRoundTime(u, s, 2, 300), flag: "changed" },
      { name: "DELETE round", seed: (u, s) => workouts().setSectionRoundTime(u, s, 2, 300), run: (u, s) => workouts().clearSectionRoundTime(u, s, 2), flag: "removed" },
      { name: "PUT result", run: (u, s) => workouts().setSectionResult(u, s, { rounds: 5, reps: 7 }), flag: "changed" },
      { name: "DELETE result", seed: (u, s) => workouts().setSectionResult(u, s, { rounds: 5, reps: 7 }), run: (u, s) => workouts().clearSectionResult(u, s), flag: "removed" },
    ];
    it.each(writes.map((w) => [w.name, w] as const))("%s on a finished workout: the second writes nothing", async (_n, w) => {
      const { u, sectionId } = await fixture({ finished: true });
      await w.seed?.(u, sectionId);
      const first = (await w.run(u, sectionId)) as Record<string, unknown>;
      expect(first[w.flag]).toBe(true);
      const after = await snapshot(sectionId);
      const second = (await w.run(u, sectionId)) as Record<string, unknown>;
      expect([second[w.flag], second.finishedEdit]).toEqual([false, null]);
      expect(await snapshot(sectionId)).toEqual(after);
      const strip = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !["changed", "removed", "finishedEdit"].includes(k)));
      expect(strip(second)).toEqual(strip(first));
    });
  });

  describe("09.5 AC18 — sequences", () => {
    type Op = { key: string; run: (u: string, s: string) => Promise<unknown> };
    const round = (r: number, s: number): Op => ({ key: `r${r}`, run: (u, id) => workouts().setSectionRoundTime(u, id, r, s) });
    const clearRound = (r: number): Op => ({ key: `r${r}`, run: (u, id) => workouts().clearSectionRoundTime(u, id, r) });
    const result = (b: SetSectionResult): Op => ({ key: "result", run: (u, id) => workouts().setSectionResult(u, id, b) });
    const clearResult: Op = { key: "result", run: (u, id) => workouts().clearSectionResult(u, id) };
    const SEQUENCE: Op[] = [round(1, 250), round(3, 700), result({ rounds: 5, reps: 7 }), clearRound(3), round(2, 515), round(3, 690), clearResult, result({ rounds: 6, reps: 0 })];

    async function apply(ops: Op[], u: string, id: string) {
      for (const op of ops) {
        await op.run(u, id).catch((e: unknown) => {
          // A reading can be out of order at that moment under a permutation; nothing else may fail.
          if (!(e instanceof ValidationError)) throw e;
        });
      }
    }
    /** Seeded swaps of adjacent operations on different keys: the same-key order is kept. */
    function permute(ops: Op[], seed: number): Op[] {
      const out = [...ops];
      let x = seed;
      for (let i = 0; i < 40; i++) {
        x = (x * 1103515245 + 12345) % 2 ** 31;
        const j = x % (out.length - 1);
        if (out[j]!.key !== out[j + 1]!.key) [out[j], out[j + 1]] = [out[j + 1]!, out[j]!];
      }
      return out;
    }

    it("once, twice in a row and 20 permutations all end in the same state", async () => {
      const once = await fixture();
      await apply(SEQUENCE, once.u, once.sectionId);
      const expected = await recorded(once.u, once.workoutId);
      expect(expected).toEqual({ timer: AMRAP, result: { rounds: 6, reps: 0, finishSeconds: null, capped: false }, roundTimes: [{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }, { round: 3, seconds: 690 }] });

      const twice = await fixture();
      await apply([...SEQUENCE, ...SEQUENCE], twice.u, twice.sectionId);
      expect(await recorded(twice.u, twice.workoutId)).toEqual(expected);

      for (let seed = 1; seed <= 20; seed++) {
        const p = await fixture();
        await apply(permute(SEQUENCE, seed), p.u, p.sectionId);
        expect(await recorded(p.u, p.workoutId), `seed ${seed}`).toEqual(expected);
      }
    }, 120_000);
  });

  it("09.5 AC19 — authorization on all five routes", async () => {
    const { u, sectionId } = await fixture();
    const other = await insertUser(db);
    for (const [actor, id] of [[u, "x"], [u, uuidv7()], [other, sectionId]] as const) {
      for (const call of [
        () => workouts().updateWorkoutSection(actor, id, { timer: SET_TIMER, discardResult: true }),
        () => workouts().setSectionRoundTime(actor, id, 1, 60),
        () => workouts().clearSectionRoundTime(actor, id, 1),
        () => workouts().setSectionResult(actor, id, { rounds: 1, reps: 1 }),
        () => workouts().clearSectionResult(actor, id),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(NotFoundError);
      }
    }
  });

  it("09.5 AC20 — finished workouts: every write works, recomputes nothing, and moves nothing but the score", async () => {
    const { u, workoutId, sectionId } = await fixture({ finished: true });
    await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
    const frozen = async () => ({
      workout: (await q(`SELECT started_at::text, ended_at::text, local_date::text FROM "workout" WHERE id = $1::uuid`, workoutId))[0],
      sets: await q(
        `SELECT to_jsonb(se) AS j FROM "set_entry" se JOIN "workout_exercise" we ON we.id = se.workout_exercise_id WHERE we.workout_id = $1::uuid ORDER BY se.id`,
        workoutId,
      ),
      history: (await workouts().listFinishedWorkouts(u, { limit: 20 })).items.map((i) => Object.fromEntries(Object.entries(i).filter(([k]) => k !== "timedSections"))),
      records: await recordsOf(db, u),
    });
    const before = await frozen();

    const created = await workouts().addWorkoutSection(u, workoutId, { name: "Extra", notes: null, timer: AMRAP });
    expect(created.finishedEdit?.recordsRecomputed).toBe(false);
    const changed = await workouts().updateWorkoutSection(u, sectionId, { timer: { format: "time_cap", capSeconds: 900 } });
    expect(changed.finishedEdit?.recordsRecomputed).toBe(false);

    const seen = await startCapture(db);
    const roundWrite = await workouts().setSectionRoundTime(u, sectionId, 1, 300);
    await settleCapture(db, seen);
    expect(roundWrite.finishedEdit?.recordsRecomputed).toBe(false);
    const advisory = seen.filter((s) => /pg_advisory_xact_lock/.test(s));
    expect(advisory).toHaveLength(1);
    expect(advisory[0]).toMatch(/hashtext\(/);
    const firstShare = seen.findIndex((s) => /FOR SHARE/.test(s));
    expect(seen.findIndex((s) => /pg_advisory_xact_lock/.test(s))).toBeLessThan(firstShare);
    expect(seen.some((s) => /SET CONSTRAINTS/.test(s))).toBe(false);
    expect(seen.some((s) => /personal_record/.test(s))).toBe(false);

    for (const run of [
      () => workouts().setSectionResult(u, sectionId, { finishSeconds: 860 }),
      () => workouts().clearSectionRoundTime(u, sectionId, 1),
      () => workouts().clearSectionResult(u, sectionId),
    ]) {
      expect((await run()).finishedEdit?.recordsRecomputed).toBe(false);
    }
    const after = await frozen();
    expect(after.workout).toEqual(before.workout);
    expect(after.sets).toEqual(before.sets);
    expect(after.history).toEqual(before.history);
    expect(after.records).toEqual(before.records);
  });

  describe("09.5 AC21 — live mode and finish races", () => {
    it("live round and result writes take no advisory lock", async () => {
      const { u, sectionId } = await fixture();
      const seen = await startCapture(db);
      await workouts().setSectionRoundTime(u, sectionId, 1, 100);
      await workouts().setSectionResult(u, sectionId, { rounds: 1, reps: 2 });
      await workouts().clearSectionRoundTime(u, sectionId, 1);
      await workouts().clearSectionResult(u, sectionId);
      await settleCapture(db, seen);
      expect(seen.some((s) => /pg_advisory_xact_lock/.test(s))).toBe(false);
    });

    const writes: [string, (u: string, s: string) => Promise<unknown>][] = [
      ["round set", (u, s) => workouts().setSectionRoundTime(u, s, 1, 100)],
      ["round clear", (u, s) => workouts().clearSectionRoundTime(u, s, 1)],
      ["result set", (u, s) => workouts().setSectionResult(u, s, { rounds: 1, reps: 2 })],
      ["result clear", (u, s) => workouts().clearSectionResult(u, s)],
      ["timer PATCH", (u, s) => workouts().updateWorkoutSection(u, s, { timer: SET_TIMER, discardResult: true })],
    ];
    it.each(writes)("%s × finish, 20 times: both settle legally, no deadlock", async (_n, write) => {
      for (let i = 0; i < 20; i++) {
        const { u, workoutId, sectionId } = await fixture();
        const [w, f] = await Promise.allSettled([write(u, sectionId), workouts().updateWorkout(u, workoutId, { endedAt: new Date().toISOString() })]);
        for (const o of [w!, f!]) {
          if (o.status === "rejected") {
            expect(String((o.reason as Error)?.message)).not.toMatch(/40P01|deadlock|40001/i);
            expect(o.reason).toBeInstanceOf(AppError);
          }
        }
        expect(f!.status).toBe("fulfilled");
        await assertSectionsConsistent(db);
      }
    }, 120_000);
  });

  describe("09.5 AC23 — cascades", () => {
    const roundCount = async (sectionId: string) =>
      (await q<{ n: number }>(`SELECT count(*)::int AS n FROM "workout_section_round" WHERE workout_section_id = $1::uuid`, sectionId))[0]!.n;

    it("removing the section, or deleting the workout, removes its round rows", async () => {
      const a = await fixture();
      await workouts().setSectionRoundTime(a.u, a.sectionId, 1, 100);
      await workouts().removeWorkoutSection(a.u, a.sectionId);
      expect(await roundCount(a.sectionId)).toBe(0);
      const b = await fixture();
      await workouts().setSectionRoundTime(b.u, b.sectionId, 1, 100);
      await workouts().deleteWorkout(b.u, b.workoutId);
      expect(await roundCount(b.sectionId)).toBe(0);
    });

    it("removing every exercise of a timed section leaves its timer, result and round times", async () => {
      const { u, workoutId, sectionId, exerciseIds } = await fixture();
      await workouts().setSectionRoundTime(u, sectionId, 1, 100);
      await workouts().setSectionResult(u, sectionId, { rounds: 1, reps: 2 });
      const before = await recorded(u, workoutId);
      await workouts().deleteWorkoutExercise(u, exerciseIds[1]!);
      await workouts().updateWorkoutExercise(u, exerciseIds[0]!, { sectionId: null });
      expect(await recorded(u, workoutId)).toEqual(before);
    });
  });

  it("09.5 AC24 — no server-side superset coupling: groups match an untimed twin after each step", async () => {
    const make = async (timer: SectionTimer | null) => {
      const f = await fixture({ timer });
      await db.prisma.$executeRawUnsafe(`UPDATE "workout_exercise" SET superset_group = 1 WHERE id = ANY($1::uuid[])`, [f.exerciseIds[0]!, f.exerciseIds[1]!]);
      return f;
    };
    const timed = await make(null);
    const twin = await make(null);
    const groups = async (workoutId: string) =>
      (await q<{ g: number | null }>(`SELECT superset_group AS g FROM "workout_exercise" WHERE workout_id = $1::uuid ORDER BY position`, workoutId)).map((r) => r.g);
    const same = async () => expect(await groups(timed.workoutId)).toEqual(await groups(twin.workoutId));

    await workouts().updateWorkoutSection(timed.u, timed.sectionId, { timer: AMRAP });
    await same();
    await workouts().setSectionRoundTime(timed.u, timed.sectionId, 1, 100);
    await workouts().updateWorkoutSection(timed.u, timed.sectionId, { timer: SET_TIMER, discardResult: true });
    await same();
    await workouts().updateWorkoutSection(timed.u, timed.sectionId, { timer: null });
    await same();
    for (const f of [timed, twin]) await workouts().updateWorkoutExercise(f.u, f.exerciseIds[2]!, { sectionId: f.sectionId });
    await same();
    for (const f of [timed, twin]) {
      const added = await workouts().addWorkoutExercise(f.u, f.workoutId, { exerciseId: f.ex });
      await workouts().updateWorkoutExercise(f.u, added.id, { sectionId: f.sectionId });
    }
    await same();
  });
});
