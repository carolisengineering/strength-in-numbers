import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import * as ownership from "../../src/repositories/ownership.js";

/** The table each helper's predicate must read its owner from: the child itself, never through a parent. */
const OWN_TABLE: Record<string, string> = {
  ownedWorkoutExercise: "workout_exercise",
  ownedSet: "set_entry",
  ownedPlannedSet: "workout_planned_set",
  ownedWorkoutSection: "workout_section",
  // A round has no id of its own: its `ref` is the round's workout_section_id, so the section is the row to check.
  ownedSectionRound: "workout_section",
  ownedRoutineItem: "routine_item",
  ownedRoutineItemSet: "routine_item_set",
  ownedRoutineSection: "routine_section",
};

describe("Spec 21.1 AC7 — the ownership helpers read the child's own user_id", () => {
  it("exports exactly the eight helpers", () => {
    expect(Object.keys(ownership).sort()).toEqual(Object.keys(OWN_TABLE).sort());
  });

  it.each(Object.entries(OWN_TABLE))("%s is one primary-key probe of %s on its own user_id, with no JOIN", (name, table) => {
    const helper = (ownership as Record<string, (u: string, ref: Prisma.Sql) => Prisma.Sql>)[name]!;
    const sql = helper("00000000-0000-0000-0000-000000000001", Prisma.sql`x.id`).sql.replace(/\s+/g, " ").trim();
    expect(sql).not.toMatch(/\bJOIN\b/i);
    expect(sql).toMatch(new RegExp(`^EXISTS \\( SELECT 1 FROM "${table}" (own_\\w+) WHERE \\1\\.id = x\\.id AND \\1\\.user_id = \\?::uuid\\)$`));
  });
});
