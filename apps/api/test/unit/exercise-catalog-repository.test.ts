import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { SyncTokenExpiredError } from "../../src/errors/app-error.js";

/**
 * Spec 03.3 AC3 / AC7 (unit layer) — the sync token must come from the *same
 * single statement* that scans the rows, including when the row set is empty.
 * A spied Prisma client fails the test if a second statement of any kind is
 * issued, so a later-snapshot fallback query cannot be reintroduced silently.
 */

const USER = "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4c";

/** The all-NULL row a LEFT JOIN yields when no exercise row matches. */
const placeholder = (extra: object = {}) => ({
  token: "736",
  id: null,
  catalog_key: null,
  owner_user_id: null,
  name: null,
  modality: null,
  primary_muscle_id: null,
  secondary_muscle_ids: null,
  equipment_id: null,
  is_active: null,
  forked_from_exercise_id: null,
  created_at: null,
  updated_at: null,
  ...extra,
});

const dataRow = (extra: object = {}) =>
  placeholder({
    id: "018f4e8a-1c2d-7f3a-8b6c-9d0e1f2a3b4d",
    name: "Squat",
    modality: "weight_reps",
    secondary_muscle_ids: [],
    is_active: true,
    created_at: new Date(0),
    updated_at: new Date(0),
    ...extra,
  });

function spied(rows: unknown[]) {
  const queryRaw = vi.fn(async () => rows);
  const forbidden = vi.fn(async () => {
    throw new Error("unexpected second statement");
  });
  const prisma = {
    $queryRaw: queryRaw,
    $executeRaw: forbidden,
    $queryRawUnsafe: forbidden,
    $executeRawUnsafe: forbidden,
    $transaction: forbidden,
  } as unknown as PrismaClient;
  return { repo: createExerciseRepository(prisma), queryRaw, forbidden };
}

/** The SQL text of the first tagged-template call, `${}` slots shown as `?`. */
const sqlOf = (q: ReturnType<typeof vi.fn>) =>
  (q.mock.calls[0]![0] as unknown as string[]).join("?");

describe("AC3/AC7 — the token comes from the same single statement as the rows", () => {
  it("full pull: exactly one $queryRaw, token derived inside it", async () => {
    const { repo, queryRaw, forbidden } = spied([dataRow()]);

    const page = await repo.findCatalog(USER);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
    expect(sqlOf(queryRaw)).toContain("pg_snapshot_xmin(pg_current_snapshot())");
    expect(sqlOf(queryRaw)).toContain("is_active = true");
    expect(page.syncToken).toBe("1.736");
    expect(page.rows).toHaveLength(1);
  });

  it("full pull with an empty visible set: still one statement, placeholder row dropped", async () => {
    const { repo, queryRaw } = spied([placeholder()]);

    expect(await repo.findCatalog(USER)).toEqual({ rows: [], syncToken: "1.736" });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it("delta: one statement, >= predicate, no is_active filter (tombstones arrive)", async () => {
    const { repo, queryRaw } = spied([dataRow({ is_active: false })]);

    const page = await repo.findCatalog(USER, "700");

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlOf(queryRaw)).toContain("change_xid >=");
    expect(sqlOf(queryRaw)).not.toContain("is_active = true");
    expect(page.rows[0]).toMatchObject({ isActive: false });
  });

  it("EMPTY delta: still exactly one statement (the path that used to run a second query)", async () => {
    const { repo, queryRaw, forbidden } = spied([
      placeholder({ since_is_future: false }),
    ]);

    expect(await repo.findCatalog(USER, "700")).toEqual({
      rows: [],
      syncToken: "1.736",
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("a future `since` throws SyncTokenExpiredError even when the row set is otherwise empty", async () => {
    const { repo, queryRaw } = spied([placeholder({ since_is_future: true })]);

    await expect(repo.findCatalog(USER, "9999")).rejects.toBeInstanceOf(
      SyncTokenExpiredError,
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
