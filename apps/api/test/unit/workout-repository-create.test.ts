// apps/api/test/unit/workout-repository-create.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { FakeExerciseRepository } from "../helpers/fakes.js";
import type { CreateWorkoutFields } from "../../src/repositories/workout.js";

/** Minimal shape of a `workout` row as the raw SQL returns it. */
interface WorkoutDbRow {
  id: string;
  user_id: string;
  title: string | null;
  notes: string | null;
  started_at: Date;
  ended_at: Date | null;
  local_date: Date;
  tz_offset_minutes: number;
  client_generated_id: string;
  source: string;
  created_at: Date;
  updated_at: Date;
}

function row(overrides: Partial<WorkoutDbRow> = {}): WorkoutDbRow {
  return {
    id: uuidv7(),
    user_id: uuidv7(),
    title: null,
    notes: null,
    started_at: new Date("2026-09-15T10:00:00.000Z"),
    ended_at: null,
    local_date: new Date("2026-09-15T00:00:00.000Z"),
    tz_offset_minutes: 0,
    client_generated_id: uuidv7(),
    source: "manual",
    created_at: new Date("2026-09-15T10:00:00.000Z"),
    updated_at: new Date("2026-09-15T10:00:00.000Z"),
    ...overrides,
  };
}

/**
 * Models the real driver's shape (pinned by the integration test in
 * `workout-create-concurrency.integration.test.ts`, AC5): `$queryRaw`'s error
 * mapping surfaces only the DETAIL line (`Key (col[, col...])=(val) already
 * exists.`) as `meta.message` — the primary message naming the constraint
 * never reaches here — so `columns` is the DETAIL's column list, not a
 * constraint name.
 */
function uniqueViolation(columns: string): Error & { code: string; meta: { code: string; message: string } } {
  const message = `Key (${columns})=(00000000-0000-0000-0000-000000000000) already exists.`;
  return Object.assign(new Error(message), {
    code: "P2010",
    meta: { code: "23505", message },
  });
}

/**
 * Records every `$queryRaw`/`$executeRaw` call and answers from a queue of
 * scripted outcomes, in call order — this is what AC5 (§10) calls "unit on
 * `createWorkoutRepository(stubPrisma)`" since the 23505 mapping and the
 * retry live in this file, which `FakeWorkoutRepository` (Task 17) replaces
 * wholesale rather than exercising.
 */
class ScriptedPrisma {
  calls: { kind: "queryRaw" | "executeRaw"; sql: string }[] = [];
  private queryQueue: Array<() => unknown[]> = [];

  queueRows(rows: unknown[]): void {
    this.queryQueue.push(() => rows);
  }
  queueError(err: Error): void {
    this.queryQueue.push(() => {
      throw err;
    });
  }

  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ kind: "queryRaw", sql: strings.join("?") });
    const next = this.queryQueue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response for $queryRaw");
    return Promise.resolve(next());
  };

  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ kind: "executeRaw", sql: strings.join("?") });
    return Promise.resolve(0);
  };

  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => fn(this);
}

function fields(overrides: Partial<CreateWorkoutFields> = {}): CreateWorkoutFields {
  return {
    clientGeneratedId: uuidv7(),
    startedAt: new Date("2026-09-15T10:00:00.000Z"),
    tzOffsetMinutes: 0,
    title: null,
    notes: null,
    ...overrides,
  };
}

describe("AC3/AC5 — createWorkout (scripted Prisma, no real DB)", () => {
  it("a row returned from the insert is a fresh create (201-shaped)", async () => {
    const stub = new ScriptedPrisma();
    const inserted = row();
    stub.queueRows([inserted]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.createWorkout(inserted.user_id, fields(), "UTC");

    expect(result.created).toBe(true);
    expect(result.workout.id).toBe(inserted.id);
  });

  it("(a) zero rows, re-read finds the stored row -> 200 replay, never 409", async () => {
    const stub = new ScriptedPrisma();
    const stored = row();
    stub.queueRows([]); // insert: zero rows (idempotency key already existed)
    stub.queueRows([stored]); // re-read: found
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.createWorkout(stored.user_id, fields(), "UTC");

    expect(result.created).toBe(false);
    expect(result.workout.id).toBe(stored.id);
  });

  it("(b) 23505 on workout_user_active_key, re-read finds a row -> 200 replay (D50)", async () => {
    const stub = new ScriptedPrisma();
    const stored = row();
    stub.queueError(uniqueViolation("user_id")); // insert throws
    stub.queueRows([stored]); // re-read: found -> this was a racing replay
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.createWorkout(stored.user_id, fields(), "UTC");

    expect(result.created).toBe(false);
    expect(result.workout.id).toBe(stored.id);
  });

  it("(c) 23505 on workout_user_active_key, re-read finds nothing -> genuine 409", async () => {
    const stub = new ScriptedPrisma();
    stub.queueError(uniqueViolation("user_id"));
    stub.queueRows([]); // re-read: empty -> real in-progress conflict
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
  });

  it("(d) 23505 on any other constraint surfaces as an internal error, never the 409, with no re-read attempted", async () => {
    const stub = new ScriptedPrisma();
    stub.queueError(uniqueViolation("id"));
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.not.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
    expect(stub.calls).toHaveLength(1); // no re-read — the branch never fires for this constraint
  });

  it("(e) zero rows + empty re-read retries the insert once; the retry succeeding -> 201-shaped", async () => {
    const stub = new ScriptedPrisma();
    const retryRow = row();
    stub.queueRows([]); // insert attempt 1: zero rows
    stub.queueRows([]); // re-read 1: empty (stored row concurrently deleted)
    stub.queueRows([retryRow]); // insert attempt 2 (retry): succeeds
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    const result = await repo.createWorkout(retryRow.user_id, fields(), "UTC");

    expect(result.created).toBe(true);
    expect(result.workout.id).toBe(retryRow.id);
  });

  it("(f) the retry itself hitting 23505 on the active key, with an empty re-read, is a genuine 409 — the delete race never suppresses a real conflict", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // insert attempt 1: zero rows
    stub.queueRows([]); // re-read 1: empty
    stub.queueError(uniqueViolation("user_id")); // insert attempt 2 (retry) throws
    stub.queueRows([]); // re-read 2: empty -> genuine conflict
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
  });

  it("(g) zero rows + empty re-read a second time fails as an internal error — the retry loop is bounded at one", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // insert attempt 1
    stub.queueRows([]); // re-read 1: empty
    stub.queueRows([]); // insert attempt 2 (retry): zero rows again
    stub.queueRows([]); // re-read 2: empty again
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await expect(repo.createWorkout(uuidv7(), fields(), "UTC")).rejects.not.toBeInstanceOf(
      WorkoutInProgressExistsError,
    );
    expect(stub.calls).toHaveLength(4); // exactly bounded: 2 inserts, 2 re-reads, no third attempt
  });
});

describe("AC14 — the create path takes no advisory lock", () => {
  it("issues no pg_advisory_xact_lock statement on the happy path", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([row()]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.createWorkout(uuidv7(), fields(), "UTC");

    expect(stub.calls.some((c) => c.sql.includes("pg_advisory_xact_lock"))).toBe(false);
  });
});

describe("AC6 — calendar derivation at write time", () => {
  it("uses the caller-supplied tzOffsetMinutes when present", async () => {
    const stub = new ScriptedPrisma();
    const inserted = row({ tz_offset_minutes: -300 });
    stub.queueRows([inserted]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    await repo.createWorkout(inserted.user_id, fields({ tzOffsetMinutes: -300 }), "America/New_York");

    const insertCall = stub.calls[0]!;
    expect(insertCall.sql).toContain("INSERT INTO");
  });

  it("derives tzOffsetMinutes from userTimezone when not supplied", async () => {
    const stub = new ScriptedPrisma();
    const inserted = row();
    stub.queueRows([inserted]);
    const repo = createWorkoutRepository(stub as unknown as PrismaClient, new FakeExerciseRepository());

    // Should not throw despite tzOffsetMinutes being undefined; offset is
    // derived via offsetMinutesForZone(startedAt, userTimezone).
    const result = await repo.createWorkout(
      inserted.user_id,
      fields({ tzOffsetMinutes: undefined }),
      "UTC",
    );

    expect(result.created).toBe(true);
  });
});
