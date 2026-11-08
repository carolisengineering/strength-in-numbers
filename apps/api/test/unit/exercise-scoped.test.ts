// apps/api/test/unit/exercise-scoped.test.ts
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import type { Prisma } from "@prisma/client";
import type { RawClient, ScopedClient, UserScopedDb } from "../../src/db/scoped.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { CustomExerciseLimitError } from "../../src/errors/app-error.js";

/** A handle that records which entry point each statement went through (and, for `as`, whose id). */
function recordingHandle(rowsFor: (sql: string) => unknown[] = () => []) {
  const shared: string[] = [];
  const scoped: { user: string; sql: string }[] = [];
  const raw = (log: (sql: string) => void): RawClient => {
    const run = (strings: TemplateStringsArray | Prisma.Sql) => {
      const sql = Array.isArray(strings) ? (strings as readonly string[]).join("?") : (strings as Prisma.Sql).sql;
      log(sql);
      return Promise.resolve(rowsFor(sql));
    };
    return { $queryRaw: run, $executeRaw: run } as unknown as RawClient;
  };
  const handle: UserScopedDb = {
    scoped: true,
    shared: () => raw((sql) => shared.push(sql)),
    forAuthSub: () => {
      throw new Error("the exercise repository never provisions");
    },
    as: (user) => {
      const client = raw((sql) => scoped.push({ user, sql }));
      return {
        ...client,
        $transaction: (fn) => fn(client as unknown as Prisma.TransactionClient),
      } as ScopedClient;
    },
  };
  return { handle, shared, scoped };
}

const isShared = (sql: string) => /"muscle_group"|"equipment"/.test(sql);

describe("Spec 21.1 AC16 — shared reads are on shared()", () => {
  it("listMuscleGroups and listEquipment each run one statement on shared(), none on as()", async () => {
    const { handle, shared, scoped } = recordingHandle();
    const repo = createExerciseRepository(handle);
    await repo.listMuscleGroups();
    await repo.listEquipment();
    expect(shared).toHaveLength(2);
    expect(shared[0]).toContain('FROM "muscle_group"');
    expect(shared[1]).toContain('FROM "equipment"');
    expect(scoped).toEqual([]);
  });

  it("the reference validation is the Promise.all pair on shared(); the capped insert runs on as(acting user)", async () => {
    const rows = (sql: string) => (sql.includes('"muscle_group"') ? [{ id: "chest" }, { id: "triceps" }] : sql.includes('"equipment"') ? [{ id: "barbell" }] : []);
    const { handle, shared, scoped } = recordingHandle(rows);
    const user = uuidv7();
    await expect(
      createExerciseRepository(handle).createExercise(user, {
        name: "Press",
        modality: "weight_reps",
        primaryMuscleId: "chest",
        secondaryMuscleIds: ["triceps"],
        equipmentId: "barbell",
      }),
    ).rejects.toBeInstanceOf(CustomExerciseLimitError); // the fake insert returns no row
    expect(shared).toHaveLength(2);
    expect(shared.every(isShared)).toBe(true);
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.every((s) => s.user === user && !isShared(s.sql))).toBe(true);
  });

  it("every user read goes through as(acting user), including the catalog's shared-plus-own rows", async () => {
    const { handle, shared, scoped } = recordingHandle((sql) => (sql.includes("pg_current_snapshot") ? [{ token: "1" }] : []));
    const user = uuidv7();
    const repo = createExerciseRepository(handle);
    await repo.findCatalog(user);
    await repo.findUsage(user);
    await expect(repo.findVisibleById(user, uuidv7())).rejects.toThrow();
    expect(shared).toEqual([]);
    expect(scoped).toHaveLength(3);
    expect(scoped.every((s) => s.user === user)).toBe(true);
  });
});
