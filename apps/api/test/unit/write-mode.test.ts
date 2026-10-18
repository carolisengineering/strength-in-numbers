// apps/api/test/unit/write-mode.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { assertStillLive, recomputeTimed, withWriteMode, WriteModeChanged, type WriteMode } from "../../src/repositories/write-mode.js";

/** Records every raw statement, in order; `$transaction` marks its start so a test can tell transactions apart. */
class ScriptedPrisma {
  calls: { sql: string }[] = [];
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve([]);
  };
  $executeRaw = (strings: TemplateStringsArray): Promise<number> => {
    this.calls.push({ sql: strings.join("?") });
    return Promise.resolve(1);
  };
  $transaction = async <T>(fn: (tx: this) => Promise<T>): Promise<T> => {
    this.calls.push({ sql: "BEGIN" });
    return fn(this);
  };
}

const PR_LOCK = "pg_advisory_xact_lock(hashtext(";
const isPrLock = (sql: string) => sql.includes(PR_LOCK);

describe("07.4 AC4 — withWriteMode lock order", () => {
  it("finished mode: the PR lock is the first statement inside the transaction", async () => {
    const stub = new ScriptedPrisma();
    await withWriteMode(stub as unknown as PrismaClient, uuidv7(), new Date(), async (tx, mode) => {
      expect(mode).toBe("finished");
      await tx.$executeRaw`SELECT 1 FROM "workout" FOR SHARE`;
    });
    expect(stub.calls[0]!.sql).toBe("BEGIN");
    expect(isPrLock(stub.calls[1]!.sql)).toBe(true);
    expect(stub.calls[2]!.sql).toContain("FOR SHARE");
  });

  it("live mode: no PR lock at all", async () => {
    const stub = new ScriptedPrisma();
    await withWriteMode(stub as unknown as PrismaClient, uuidv7(), null, async (tx, mode) => {
      expect(mode).toBe("live");
      await tx.$executeRaw`SELECT 1 FROM "workout" FOR SHARE`;
    });
    expect(stub.calls.some((c) => isPrLock(c.sql))).toBe(false);
  });
});

describe("07.4 AC5 — a flip restarts the request once in finished mode", () => {
  it("a live run that finds the workout finished under its lock re-runs once, starting with the PR lock", async () => {
    const stub = new ScriptedPrisma();
    const modes: WriteMode[] = [];
    const result = await withWriteMode(stub as unknown as PrismaClient, uuidv7(), null, async (_tx, mode) => {
      modes.push(mode);
      assertStillLive(mode, mode === "live" ? new Date() : new Date()); // finished under the row lock
      return "done";
    });
    expect(result).toBe("done");
    expect(modes).toEqual(["live", "finished"]);
    const secondBegin = stub.calls.map((c) => c.sql).lastIndexOf("BEGIN");
    expect(secondBegin).toBeGreaterThan(0);
    expect(isPrLock(stub.calls[secondBegin + 1]!.sql)).toBe(true);
  });

  it("assertStillLive is silent while the workout is still live, and in finished mode", () => {
    expect(() => assertStillLive("live", null)).not.toThrow();
    expect(() => assertStillLive("finished", new Date())).not.toThrow();
    expect(() => assertStillLive("live", new Date())).toThrow(WriteModeChanged);
  });

  it("a flip reported from a finished run is a bug and surfaces", async () => {
    const stub = new ScriptedPrisma();
    await expect(
      withWriteMode(stub as unknown as PrismaClient, uuidv7(), new Date(), async () => {
        throw new WriteModeChanged();
      }),
    ).rejects.toBeInstanceOf(WriteModeChanged);
  });

  it("any other error is not retried", async () => {
    const stub = new ScriptedPrisma();
    let runs = 0;
    await expect(
      withWriteMode(stub as unknown as PrismaClient, uuidv7(), null, async () => {
        runs += 1;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(runs).toBe(1);
  });
});

describe("07.4 AC8 — recomputeTimed", () => {
  it("no roots: no query and records_recomputed false", async () => {
    const stub = new ScriptedPrisma();
    const edit = await recomputeTimed(stub as unknown as PrismaClient, uuidv7(), "w-1", []);
    expect(edit).toEqual({ workoutId: "w-1", recordsRecomputed: false, rootCount: 0, recomputeMs: 0 });
    expect(stub.calls).toHaveLength(0);
  });
});
