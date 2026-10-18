// apps/api/test/unit/workout-repository-reorder.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError, ValidationError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown[]> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(0);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

const ownedRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_id: uuidv7(),
  position: 1,
  notes: null,
  user_id: uuidv7(),
  ended_at: null,
  ...overrides,
});

const exerciseRow = (overrides: Record<string, unknown> = {}) => ({
  id: uuidv7(),
  workout_id: uuidv7(),
  position: 0,
  exercise_id: uuidv7(),
  exercise_name_snapshot: "x",
  modality_snapshot: "weight_reps",
  notes: null,
  created_at: new Date(),
  updated_at: new Date(),
  planned_sets: [],
  section_id: null,
  ...overrides,
});

describe("AC15 — updateWorkoutExercise ownership", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.updateWorkoutExercise(uuidv7(), "bad-id", {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent row or one whose parent workout belongs to another user is NotFoundError", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(repo.updateWorkoutExercise(uuidv7(), uuidv7(), {})).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("AC9 (amended by 07.4) — updateWorkoutExercise on a finished parent", () => {
  it("07.4 AC4 / AC7 — a reorder: PR lock first, then the move, then a recompute of the repeated roots only", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: row.ended_at }]); // FOR SHARE
    stub.queueRows([{ id: row.id, position: 1, notes: null, superset_group: null }]); // FOR UPDATE
    stub.queueRows([{ n: 3 }]);
    stub.queueRows([exerciseRow({ id: row.id, position: 0 })]); // UPDATE … RETURNING
    stub.queueRows([{ root_id: uuidv7() }]); // rootsRepeatedInWorkout
    stub.queueRows([]); // recompute loader: no qualifying sets
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 0 });
    expect(result.moved).toBe(true);
    expect(result.finishedEdit).toMatchObject({ recordsRecomputed: true, rootCount: 1 });
    expect(stub.calls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(stub.calls.some((c) => c.sql.includes("HAVING count(*) > 1"))).toBe(true);
  });

  it("07.4 AC7 — a notes-only patch on a finished parent recomputes nothing", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ ended_at: new Date("2026-09-15T11:00:00.000Z") });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: row.ended_at }]);
    stub.queueRows([{ id: row.id, position: 1, notes: null, superset_group: null }]);
    stub.queueRows([{ n: 3 }]);
    stub.queueRows([exerciseRow({ id: row.id, position: 1, notes: "hi" })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { notes: "hi" });
    expect(result.moved).toBe(false);
    expect(result.finishedEdit).toMatchObject({ recordsRecomputed: false });
    expect(stub.calls.some((c) => c.sql.includes("personal_record"))).toBe(false);
  });

  it("07.4 AC5 — a finish after phase 1 restarts once in finished mode instead of 409", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow();
    stub.queueRows([row]); // phase 1: in progress
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]); // live FOR SHARE → restart
    stub.queueRows([{ ended_at: new Date("2026-09-15T11:00:00.000Z") }]);
    stub.queueRows([{ id: row.id, position: 1, notes: null, superset_group: null }]);
    stub.queueRows([{ n: 3 }]);
    stub.queueRows([exerciseRow({ id: row.id, position: 1, notes: "hi" })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { notes: "hi" });
    expect(result.notes).toBe("hi");
  });
});
describe("AC7/AC11 — notes-only edit goes through the same lock/FOR-SHARE transaction", () => {
  it("succeeds on an in-progress workout, with the lock/FOR SHARE/deferred-constraint statements present", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 2 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ id: row.id, position: 2, notes: null }]); // FOR UPDATE target
    stub.queueRows([{ n: 3 }]); // count
    stub.queueRows([
      exerciseRow({ id: row.id, workout_id: row.workout_id, position: 2, notes: "updated" }),
    ]); // final UPDATE ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { notes: "updated" });

    expect(result.notes).toBe("updated");
    expect(result.position).toBe(2);
    // A notes-only patch still runs the full transaction: phase-1 read,
    // SET CONSTRAINTS, lock, FOR SHARE, FOR UPDATE target, count, final
    // UPDATE -- no shift statement fires since position is unchanged.
    expect(stub.calls).toHaveLength(7);
    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(stub.calls.some((c) => c.sql.includes("SET CONSTRAINTS"))).toBe(true);
    expect(stub.calls.some((c) => c.sql.includes("FOR SHARE"))).toBe(true);
    expect(stub.calls.some((c) => c.sql.includes("position = position - 1"))).toBe(false);
    expect(stub.calls.some((c) => c.sql.includes("position = position + 1"))).toBe(false);
  });

  it("a row vanished between phase 1 and the FOR UPDATE target re-fetch is NotFoundError, not a crash", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow();
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([]); // FOR UPDATE target: no row (deleted meanwhile)
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());
    await expect(
      repo.updateWorkoutExercise(row.user_id, row.id, { notes: "updated" }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("AC11 — reorder range + no-op", () => {
  it("a reorder to the row's current position is a no-op returning the row unchanged", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]); // phase 1
    stub.queueRows([{ ended_at: null }]); // FOR SHARE
    stub.queueRows([{ id: row.id, position: 1, notes: null }]); // FOR UPDATE target re-fetch
    stub.queueRows([{ n: 3 }]); // count
    stub.queueRows([
      exerciseRow({ id: row.id, workout_id: row.workout_id, position: 1 }),
    ]); // final UPDATE ... RETURNING
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 1 });
    expect(result.position).toBe(1);
    // No shift statement fired -- phase-1 read, then SET CONSTRAINTS, lock,
    // FOR SHARE, FOR UPDATE, count, and the final UPDATE.
    expect(stub.calls).toHaveLength(7);
  });

  it("position = n (out of the 0..n-1 reorder range) is a ValidationError", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 0 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 0, notes: null }]);
    stub.queueRows([{ n: 3 }]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(
      repo.updateWorkoutExercise(row.user_id, row.id, { position: 3 }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("AC12 — reorder renumbering arithmetic", () => {
  it("a forward move shifts the strictly-between rows back by one", async () => {
    // Rows at 0 (target), 1, 2, 3 -- move the target from 0 to 2.
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 0 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 0, notes: null }]);
    stub.queueRows([{ n: 4 }]);
    stub.queueRows([exerciseRow({ id: row.id, workout_id: row.workout_id, position: 2 })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 2 });

    expect(result.position).toBe(2);
    const shiftCall = stub.calls.find(
      (c) => c.sql.includes("UPDATE") && c.sql.includes("workout_exercise") && c.sql.includes("position"),
    );
    // Exactly one shift statement (forward: decrement the in-between span).
    const shiftCalls = stub.calls.filter((c) => c.sql.includes("position = position - 1"));
    expect(shiftCalls).toHaveLength(1);
    expect(stub.calls.some((c) => c.sql.includes("position = position + 1"))).toBe(false);
    expect(shiftCall).toBeDefined();
  });

  it("a backward move shifts the strictly-between rows forward by one", async () => {
    // Rows at 0, 1, 2 (target) -- move the target from 2 to 0.
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 2 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 2, notes: null }]);
    stub.queueRows([{ n: 3 }]);
    stub.queueRows([exerciseRow({ id: row.id, workout_id: row.workout_id, position: 0 })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 0 });

    expect(result.position).toBe(0);
    const shiftCalls = stub.calls.filter((c) => c.sql.includes("position = position + 1"));
    expect(shiftCalls).toHaveLength(1);
    expect(stub.calls.some((c) => c.sql.includes("position = position - 1"))).toBe(false);
  });

  it("a direct two-row swap (AC12) lands the moved row and the other row at dense positions", async () => {
    // Only two rows: 0 and 1 (the target). Move the target from 1 to 0 -- a
    // plain swap, the most demanding case for the deferred constraint.
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 1 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 1, notes: null }]);
    stub.queueRows([{ n: 2 }]);
    stub.queueRows([exerciseRow({ id: row.id, workout_id: row.workout_id, position: 0 })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.updateWorkoutExercise(row.user_id, row.id, { position: 0 });

    expect(result.position).toBe(0);
    // Backward move: the other row (at 0) shifts to 1 in one statement, the
    // target is then set to 0 in a separate statement -- a valid two-step
    // path under SET CONSTRAINTS ... DEFERRED, final state dense {0,1}.
    const shiftCalls = stub.calls.filter((c) => c.sql.includes("position = position + 1"));
    expect(shiftCalls).toHaveLength(1);
    // SET CONSTRAINTS is present -- required even for this "safe-looking"
    // shift (§6.7).
    expect(stub.calls.some((c) => c.sql.includes("SET CONSTRAINTS"))).toBe(true);
  });
});

describe("AC13 — statement order: lock is its own statement, FOR SHARE is separate", () => {
  it("orders SET CONSTRAINTS, lock, FOR SHARE, FOR UPDATE target, count, then the shift/final UPDATE", async () => {
    const stub = new ScriptedPrisma();
    const row = ownedRow({ position: 0 });
    stub.queueRows([row]);
    stub.queueRows([{ ended_at: null }]);
    stub.queueRows([{ id: row.id, position: 0, notes: null }]);
    stub.queueRows([{ n: 2 }]);
    stub.queueRows([exerciseRow({ id: row.id, workout_id: row.workout_id, position: 1 })]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.updateWorkoutExercise(row.user_id, row.id, { position: 1 });

    // calls[0] is the phase-1 ownership/finished SELECT (no transaction yet).
    const txCalls = stub.calls.slice(1);
    expect(txCalls[0]!.sql).toContain("SET CONSTRAINTS");
    expect(txCalls[1]!.sql).toContain("pg_advisory_xact_lock");
    expect(txCalls[2]!.sql).toContain("FOR SHARE");
    expect(txCalls[3]!.sql).toContain("FOR UPDATE");
    expect(txCalls[4]!.sql).toContain("count(*)");
  });
});
