import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NotFoundError } from "../../src/errors/app-error.js";
import { findSetByClientGeneratedId, loadSetsForWorkout, lockedWorkoutSpan } from "../../src/repositories/set-entry.prisma.js";
import { lockSectionForRecord, lockWorkoutStructure } from "../../src/repositories/workout-section.prisma.js";
import { createWorkoutRepository, loadExercises, loadSectionSnapshot } from "../../src/repositories/workout.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { loadWorkingSetRows } from "../../src/repositories/workout-history.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { buildWorld, type World } from "./cross-user/world.js";
import { snapshot } from "./cross-user/snapshot.js";

/**
 * Spec 21.0 §6.7, AC23–AC25 — the statements that relied on a separate, earlier ownership check now carry their
 * own user predicate (or are tied to a user-filtered anchor in the same transaction). Each is called directly with
 * a mismatched (user, id) pair: it must find, return or change nothing. The world is Phase A's cross-user world.
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.0 Phase B — weak-spot predicates (real Postgres)", () => {
  let db: IntegrationDb;
  let w: World;
  const notFound = () => new NotFoundError("not found");

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    w = await buildWorld(db);
  }, 300_000);
  afterAll(async () => {
    await db?.stop();
  });

  /** Runs `fn` in a transaction that is always rolled back, so lock helpers can be called on their own. */
  async function inRolledBackTx<T>(fn: (tx: Parameters<Parameters<IntegrationDb["prisma"]["$transaction"]>[0]>[0]) => Promise<T>): Promise<T> {
    const rollback = new Error("rollback");
    let out: T | undefined;
    await db.prisma
      .$transaction(async (tx) => {
        out = await fn(tx);
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });
    return out as T;
  }

  /** The mismatched call must change none of B's rows. */
  async function bUnchanged(call: () => Promise<unknown>) {
    const before = await snapshot(db, w.b.userId);
    await expect(call()).rejects.toBeInstanceOf(NotFoundError);
    expect(await snapshot(db, w.b.userId)).toBe(before);
  }

  describe("AC23 — the set replay lookup is user-filtered (§6.7 #1)", () => {
    it("A asking with B's workout exercise and B's key finds nothing", async () => {
      expect(await findSetByClientGeneratedId(db.prisma, w.a.userId, w.b.finishedWorkoutExercise, w.b.finishedSetClientId)).toBeUndefined();
    });
    it("B asking finds B's set (the control)", async () => {
      const found = await findSetByClientGeneratedId(db.prisma, w.b.userId, w.b.finishedWorkoutExercise, w.b.finishedSetClientId);
      expect(found?.id).toBe(w.b.finishedSet);
    });
  });

  describe("AC25 — the anchor locks filter on the acting user (§6.7 #2, #12)", () => {
    it("lockedWorkoutSpan with B's workout as A finds no row", async () => {
      await expect(inRolledBackTx((tx) => lockedWorkoutSpan(tx, w.a.userId, w.b.finishedWorkout, "nope"))).rejects.toBeInstanceOf(NotFoundError);
      const own = await inRolledBackTx((tx) => lockedWorkoutSpan(tx, w.b.userId, w.b.finishedWorkout, "nope"));
      expect(own.ended_at).not.toBeNull();
    });
    it("lockWorkoutStructure with B's workout as A finds no row", async () => {
      await expect(inRolledBackTx((tx) => lockWorkoutStructure(tx, w.a.userId, "live", w.b.liveWorkout, notFound))).rejects.toBeInstanceOf(NotFoundError);
      await inRolledBackTx((tx) => lockWorkoutStructure(tx, w.b.userId, "live", w.b.liveWorkout, notFound));
    });
    it("the section envelope's workout lock with B's workout as A finds no row", async () => {
      await expect(
        inRolledBackTx((tx) => lockSectionForRecord(tx, w.a.userId, "finished", w.b.finishedWorkout, w.b.finishedSection)),
      ).rejects.toBeInstanceOf(NotFoundError);
      const own = await inRolledBackTx((tx) => lockSectionForRecord(tx, w.b.userId, "finished", w.b.finishedWorkout, w.b.finishedSection));
      expect(own.id).toBe(w.b.finishedSection);
    });
  });

  describe("AC24 — every fixed statement, called with another owner's id, matches nothing", () => {
    it("§6.7 #13: a section lock anchored on A's workout doesn't lock B's section", async () => {
      await expect(
        inRolledBackTx((tx) => lockSectionForRecord(tx, w.a.userId, "finished", w.a.finishedWorkout, w.b.finishedSection)),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("§6.7 #5: the detail loaders read nothing of B's workout for A", async () => {
      expect(await loadSetsForWorkout(db.prisma, w.a.userId, w.b.finishedWorkout)).toEqual([]);
      expect(await loadExercises(db.prisma, w.a.userId, w.b.finishedWorkout)).toEqual([]);
      expect((await loadSectionSnapshot(db.prisma, w.a.userId, w.b.finishedWorkout)).sections).toEqual([]);
      // Controls: B reads its own.
      expect((await loadSetsForWorkout(db.prisma, w.b.userId, w.b.finishedWorkout)).length).toBeGreaterThan(0);
      expect((await loadExercises(db.prisma, w.b.userId, w.b.finishedWorkout)).length).toBeGreaterThan(0);
      expect((await loadSectionSnapshot(db.prisma, w.b.userId, w.b.finishedWorkout)).sections.length).toBeGreaterThan(0);
    });

    it("the History volume read (found by the B4 audit, beyond §6.7) reads no set of B's workout for A", async () => {
      expect(await loadWorkingSetRows(db.prisma, w.a.userId, [w.b.finishedWorkout])).toEqual([]);
      expect((await loadWorkingSetRows(db.prisma, w.b.userId, [w.b.finishedWorkout])).length).toBeGreaterThan(0);
    });

    // The repository methods: a mismatched call is a 404 and leaves B's rows as they were (§6.7 #3, #4, #8, #10, #13, #15, #18).
    const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));

    it("§6.7 #3: a set create on B's workout exercise", () =>
      bUnchanged(() => workouts().createSet(w.a.userId, w.b.liveWorkoutExercise, { reps: 5 } as never)));
    it("§6.7 #4: a set update and a set delete on B's set", async () => {
      await bUnchanged(() => workouts().updateSet(w.a.userId, w.b.liveSet, { reps: 9 } as never));
      await bUnchanged(() => workouts().deleteSet(w.a.userId, w.b.finishedSet));
    });
    it("§6.7 #8: a workout-exercise update and delete on B's workout exercise", async () => {
      await bUnchanged(() => workouts().updateWorkoutExercise(w.a.userId, w.b.liveWorkoutExercise, { notes: "A" } as never));
      await bUnchanged(() => workouts().deleteWorkoutExercise(w.a.userId, w.b.finishedWorkoutExercise));
    });
    it("§6.7 #10: a workout delete of B's workout", () => bUnchanged(() => workouts().deleteWorkout(w.a.userId, w.b.finishedWorkout)));
    it("§6.7 #13: section update, remove, round and result writes on B's section", async () => {
      const repo = workouts();
      await bUnchanged(() => repo.updateWorkoutSection(w.a.userId, w.b.finishedSection, { name: "A" } as never));
      await bUnchanged(() => repo.removeWorkoutSection(w.a.userId, w.b.liveSection));
      await bUnchanged(() => repo.setSectionRoundTime(w.a.userId, w.b.finishedSection, 2, 100));
      await bUnchanged(() => repo.clearSectionRoundTime(w.a.userId, w.b.finishedSection, 1));
      await bUnchanged(() => repo.setSectionResult(w.a.userId, w.b.finishedSection, { rounds: 9, reps: 1 } as never));
      await bUnchanged(() => repo.clearSectionResult(w.a.userId, w.b.finishedSection));
    });
    it("§6.7 #15: a routine replace of B's routine", () =>
      bUnchanged(() =>
        createRoutineRepository(db.prisma).replace(w.a.userId, w.b.routine, {
          name: "A",
          notes: null,
          items: [{ exerciseId: w.a.customExercise, targetSets: 1, targetRepsLow: 5, targetRepsHigh: 5 }],
        } as never),
      ));
    it("§6.7 #18: a Hevy link begin and complete on B's workout", async () => {
      const hevy = createHevyRepository(db.prisma);
      await bUnchanged(() => hevy.beginLink(w.a.userId, w.b.finishedWorkout, { relink: true } as never));
      await bUnchanged(() => hevy.completeLink(w.a.userId, w.b.finishedWorkout, { hevyWorkoutId: "h-a", fingerprint: `v1:${"0".repeat(64)}` }));
    });
  });
});
