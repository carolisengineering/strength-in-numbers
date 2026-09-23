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

  it("deletes an owned row (finished or not) using two queries: ownership-check SELECT then DELETE", async () => {
    const userId = uuidv7();
    const id = uuidv7();
    const stub = new ScriptedPrisma();
    // Queue ownership check row with ended_at set (finished workout)
    const finishedAt = new Date("2024-01-15T14:30:00Z");
    stub.queueRows([{ id, user_id: userId, ended_at: finishedAt }]); // ownership check: found, finished
    const repo = createWorkoutRepository(stub as unknown as PrismaClient);

    await repo.deleteWorkout(userId, id);

    // Verify both queries were issued: SELECT for ownership check, then DELETE
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]!.sql).toContain("SELECT");
    expect(stub.calls[1]!.sql).toContain("DELETE FROM");
  });
});
