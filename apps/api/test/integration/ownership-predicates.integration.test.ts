import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  ownedPlannedSet,
  ownedRoutineItem,
  ownedRoutineItemSet,
  ownedRoutineSection,
  ownedSectionRound,
  ownedSet,
  ownedWorkoutExercise,
  ownedWorkoutSection,
} from "../../src/repositories/ownership.js";
import { shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { buildWorld, type World } from "./cross-user/world.js";
import { OWNERSHIP_MAP } from "./cross-user/snapshot.js";

/**
 * Spec 21.0 AC22 — one SQL predicate per owned table that has no `user_id`, each an
 * `EXISTS` through the parent chain to the root's `user_id`. Run against the
 * cross-user world: for every table, a helper with A's id selects exactly A's
 * rows (the ownership map's count), and with B's id exactly B's.
 */
const CASES: { table: string; ref: Prisma.Sql; helper: (userId: string, ref: Prisma.Sql) => Prisma.Sql }[] = [
  { table: "workout_exercise", ref: Prisma.sql`t.id`, helper: ownedWorkoutExercise },
  { table: "set_entry", ref: Prisma.sql`t.id`, helper: ownedSet },
  { table: "workout_planned_set", ref: Prisma.sql`t.id`, helper: ownedPlannedSet },
  { table: "workout_section", ref: Prisma.sql`t.id`, helper: ownedWorkoutSection },
  // A round has no id of its own: its key is (workout_section_id, round_no).
  { table: "workout_section_round", ref: Prisma.sql`t.workout_section_id`, helper: ownedSectionRound },
  { table: "routine_item", ref: Prisma.sql`t.id`, helper: ownedRoutineItem },
  { table: "routine_item_set", ref: Prisma.sql`t.id`, helper: ownedRoutineItemSet },
  { table: "routine_section", ref: Prisma.sql`t.id`, helper: ownedRoutineSection },
];

describe.skipIf(!shouldRunIntegration())("Spec 21.0 AC22 — shared ownership predicates (real Postgres)", () => {
  let db: AppIntegrationDb;
  let world: World;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    world = await buildWorld(db);
  }, 300_000);
  afterAll(async () => {
    await db?.stop();
  });

  const owned = async (table: string, userId: string) => (await db.prisma.$queryRawUnsafe<unknown[]>(OWNERSHIP_MAP[table]!, userId)).length;

  for (const c of CASES) {
    it(`AC22 — ${c.table}: the helper selects exactly the acting user's rows`, async () => {
      for (const userId of [world.a.userId, world.b.userId]) {
        const [row] = await db.prisma.$queryRaw<{ n: number }[]>`
          SELECT count(*)::int AS n FROM ${Prisma.raw(`"${c.table}"`)} t WHERE ${c.helper(userId, c.ref)}`;
        const expected = await owned(c.table, userId);
        expect(expected, `${c.table} fixture rows`).toBeGreaterThan(0);
        expect(row!.n).toBe(expected);
      }
    });
  }

  it("AC22 — an outer alias that matches an inner one doesn't capture the subquery", async () => {
    // The caller names its table `we`, as several repositories do; the helper's own aliases must not shadow it.
    const [row] = await db.prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM "workout_exercise" we WHERE ${ownedWorkoutExercise(world.a.userId, Prisma.sql`we.id`)}`;
    expect(row!.n).toBe(await owned("workout_exercise", world.a.userId));
  });
});
