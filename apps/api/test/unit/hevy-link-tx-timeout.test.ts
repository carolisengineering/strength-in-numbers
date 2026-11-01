import type { PrismaClient } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { describe, expect, it, vi } from "vitest";
import { createHevyRepository, HEVY_LINK_TX_TIMEOUT_MS } from "../../src/repositories/hevy.prisma.js";

/** Minor 212: begin and complete read the whole workout inside their transaction, so both get an explicit timeout. */
describe("Minor 212 — the Hevy link begin and complete transactions have the import's timeout", () => {
  const sentinel = new Error("stop at the transaction");
  const captured: unknown[] = [];
  const prisma = {
    $transaction: vi.fn(async (_fn: unknown, opts?: unknown) => {
      captured.push(opts);
      throw sentinel;
    }),
  } as unknown as PrismaClient;
  const repo = createHevyRepository(prisma);

  it("is 30 s, the same as the import write", () => expect(HEVY_LINK_TX_TIMEOUT_MS).toBe(30_000));

  it("begin passes it", async () => {
    captured.length = 0;
    await expect(repo.beginLink(uuidv7(), uuidv7(), { relink: false })).rejects.toBe(sentinel);
    expect(captured).toEqual([{ timeout: 30_000 }]);
  });

  it("complete passes it", async () => {
    captured.length = 0;
    await expect(repo.completeLink(uuidv7(), uuidv7(), { hevyWorkoutId: "h-1", fingerprint: "v1:x" })).rejects.toBe(sentinel);
    expect(captured).toEqual([{ timeout: 30_000 }]);
  });
});
