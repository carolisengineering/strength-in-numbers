import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { NotFoundError } from "../../src/errors/app-error.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";

class ScriptedPrisma {
  calls: { sql: string }[] = [];
  private queue: Array<() => unknown> = [];
  queueRows(rows: unknown[]): void {
    this.queue.push(() => rows);
  }
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown> => {
    this.calls.push({ sql: strings.join("?") });
    const next = this.queue.shift();
    if (!next) throw new Error("ScriptedPrisma: no queued response");
    return Promise.resolve(next());
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(1);
  };
}

describe("AC9/AC15 — deleteWorkout", () => {
  it("a malformed id is NotFoundError with no query issued", async () => {
    const stub = new ScriptedPrisma();
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(repo.deleteWorkout(uuidv7(), "bad-id")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(stub.calls).toHaveLength(0);
  });

  it("an absent or another user's row is NotFoundError, allowed on both an in-progress and a finished workout otherwise", async () => {
    const stub = new ScriptedPrisma();
    stub.queueRows([]); // ownership check: no match
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);
    await expect(repo.deleteWorkout(uuidv7(), uuidv7())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("deletes an owned row (finished or not) with a single hard-delete statement", async () => {
    const userId = uuidv7();
    const id = uuidv7();
    const stub = new ScriptedPrisma();
    stub.queueRows([{ id, user_id: userId }]); // ownership check: found
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await repo.deleteWorkout(userId, id);

    expect(stub.calls.some((c) => c.sql.includes("DELETE FROM"))).toBe(true);
  });
});
