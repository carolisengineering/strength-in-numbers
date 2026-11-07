// Spec 09.5 AC4, AC5, AC34 — migration 0018 (timed sections), real Postgres.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { applyMigrationFile, insertUser, shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

const MIGRATIONS = readdirSync(fileURLToPath(new URL("../../prisma/migrations/", import.meta.url)))
  .filter((d) => /^\d{4}_/.test(d))
  .sort();

const TIMER_COLUMNS = ["timer_format", "timer_round_s", "timer_rounds", "timer_cap_s"] as const;
const RESULT_COLUMNS = ["result_rounds", "result_reps", "result_finish_s"] as const;
const NO_TIMER = "timer_format = NULL, timer_round_s = NULL, timer_rounds = NULL, timer_cap_s = NULL";
const NO_RESULT = "result_rounds = NULL, result_reps = NULL, result_finish_s = NULL, result_capped = false";

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — migration 0018 (real Postgres)", () => {
  let db: IntegrationDb;
  let routine: string;
  let routineSection: string;
  let workout: string;
  let workoutSection: string;

  const sql = (text: string, ...args: unknown[]) => db.prisma.$executeRawUnsafe(text, ...args);
  const rejectsWith = (code: string, p: Promise<unknown>) => expect(p).rejects.toThrow(new RegExp(code));
  const setRow = (table: "routine_section" | "workout_section", set: string) =>
    sql(`UPDATE "${table}" SET ${set} WHERE id = $1::uuid`, table === "routine_section" ? routineSection : workoutSection);
  const reset = async () => {
    await sql(`DELETE FROM "workout_section_round"`);
    await setRow("workout_section", `${NO_RESULT}, ${NO_TIMER}`);
    await setRow("routine_section", NO_TIMER);
  };

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    for (const dir of MIGRATIONS.filter((d) => d < "0018")) applyMigrationFile(db.url, dir);
    const user = await insertUser(db);
    routine = uuidv7();
    routineSection = uuidv7();
    workout = uuidv7();
    workoutSection = uuidv7();
    await sql(`INSERT INTO "routine" (id, user_id, name) VALUES ($1::uuid, $2::uuid, 'Old')`, routine, user);
    await sql(`INSERT INTO "routine_section" (id, routine_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'Main')`, routineSection, routine);
    await sql(
      `INSERT INTO "workout" ("id","user_id","started_at","local_date","tz_offset_minutes","client_generated_id")
       VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',current_date,0,$3::uuid)`,
      workout,
      user,
      uuidv7(),
    );
    await sql(`INSERT INTO "workout_section" (id, workout_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'Main')`, workoutSection, workout);
    for (const dir of MIGRATIONS.filter((d) => d >= "0018")) applyMigrationFile(db.url, dir);
  }, 240_000);
  afterAll(async () => {
    await db?.stop();
  });

  it("09.5 AC4 — existing rows read untimed", async () => {
    const [r] = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${TIMER_COLUMNS.join(", ")} FROM "routine_section" WHERE id = $1::uuid`,
      routineSection,
    );
    expect(r).toEqual({ timer_format: null, timer_round_s: null, timer_rounds: null, timer_cap_s: null });
    const [w] = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${[...TIMER_COLUMNS, ...RESULT_COLUMNS, "result_capped"].join(", ")} FROM "workout_section" WHERE id = $1::uuid`,
      workoutSection,
    );
    expect(w).toEqual({
      timer_format: null,
      timer_round_s: null,
      timer_rounds: null,
      timer_cap_s: null,
      result_rounds: null,
      result_reps: null,
      result_finish_s: null,
      result_capped: false,
    });
    const rounds = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "workout_section_round"`);
    expect(Number(rounds[0]!.n)).toBe(0);
  });

  describe("09.5 AC4 — CHECKs reject (raw SQL)", () => {
    const planRows: [string, string][] = [
      ["an unknown format", `timer_format = 'emom', timer_cap_s = 60`],
      ["set_timer with a cap", `timer_format = 'set_timer', timer_round_s = 300, timer_rounds = 5, timer_cap_s = 60`],
      ["set_timer missing rounds", `timer_format = 'set_timer', timer_round_s = 300`],
      ["amrap with rounds", `timer_format = 'amrap', timer_cap_s = 720, timer_rounds = 5`],
      ["amrap with no cap", `timer_format = 'amrap'`],
      ["time_cap with cap 0", `timer_format = 'time_cap', timer_cap_s = 0`],
      ["time_cap with a round length", `timer_format = 'time_cap', timer_round_s = 60`],
      ["set_timer round_s 3601", `timer_format = 'set_timer', timer_round_s = 3601, timer_rounds = 5`],
      ["set_timer round_s 0", `timer_format = 'set_timer', timer_round_s = 0, timer_rounds = 5`],
      ["set_timer rounds 101", `timer_format = 'set_timer', timer_round_s = 300, timer_rounds = 101`],
      ["amrap cap 10801", `timer_format = 'amrap', timer_cap_s = 10801`],
      ["plan columns with a NULL format", `timer_cap_s = 600`],
    ];
    it.each(planRows.flatMap(([name, set]) => (["routine_section", "workout_section"] as const).map((t) => [t, name, set] as const)))(
      "%s: %s",
      async (table, _name, set) => {
        await reset();
        await rejectsWith("23514", setRow(table, set));
      },
    );

    const resultRows: [string, string][] = [
      ["a result on an untimed section", `result_finish_s = 600`],
      ["a capped flag on an untimed section", `result_capped = true, result_rounds = 1`],
      ["an AMRAP result missing reps", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 5`],
      ["an AMRAP result with a finish time", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 5, result_reps = 1, result_finish_s = 60`],
      ["a Time Cap with both a finish and capped", `timer_format = 'time_cap', timer_cap_s = 900, result_finish_s = 600, result_capped = true, result_rounds = 1`],
      ["capped with a NULL cap", `timer_format = 'time_cap', result_capped = true, result_rounds = 4`],
      ["a finish over the cap", `timer_format = 'time_cap', timer_cap_s = 900, result_finish_s = 901`],
      ["capped with neither rounds nor reps", `timer_format = 'time_cap', timer_cap_s = 900, result_capped = true`],
      ["a Time Cap finish with rounds", `timer_format = 'time_cap', timer_cap_s = 900, result_finish_s = 600, result_rounds = 2`],
      ["a result on a Set Timer", `timer_format = 'set_timer', timer_round_s = 300, timer_rounds = 5, result_rounds = 1, result_reps = 1`],
      ["result_rounds 1000", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 1000, result_reps = 0`],
      ["result_reps 10000", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 0, result_reps = 10000`],
      ["result_finish_s 0", `timer_format = 'time_cap', result_finish_s = 0`],
      ["result_finish_s 10801", `timer_format = 'time_cap', result_finish_s = 10801`],
    ];
    it.each(resultRows)("workout_section: %s", async (_name, set) => {
      await reset();
      await rejectsWith("23514", setRow("workout_section", set));
    });
  });

  describe("09.5 AC4 — round table", () => {
    const addRound = (section: string, round: number, seconds: number) =>
      sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, $2, $3)`, section, round, seconds);

    it.each([
      [0, 60],
      [101, 60],
      [1, 0],
      [1, 10801],
    ])("round %i, %i s → 23514", async (round, seconds) => {
      await reset();
      await setRow("workout_section", `timer_format = 'amrap', timer_cap_s = 720`);
      await rejectsWith("23514", addRound(workoutSection, round, seconds));
    });

    it("a duplicate (section, round_no) → 23505", async () => {
      await reset();
      await setRow("workout_section", `timer_format = 'amrap', timer_cap_s = 720`);
      await addRound(workoutSection, 1, 60);
      await rejectsWith("23505", addRound(workoutSection, 1, 90));
      await reset();
    });

    it("deleting the section, or its workout, removes its round rows", async () => {
      const user = await insertUser(db);
      const count = async (section: string) =>
        Number(
          (await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "workout_section_round" WHERE workout_section_id = $1::uuid`, section))[0]!.n,
        );
      for (const target of ["section", "workout"] as const) {
        const w = uuidv7();
        const s = uuidv7();
        await sql(
          `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
           VALUES ($1::uuid,$2::uuid,now() - interval '1 hour',now(),current_date,0,$3::uuid)`,
          w,
          user,
          uuidv7(),
        );
        await sql(
          `INSERT INTO "workout_section" (id, workout_id, position, name, timer_format, timer_cap_s) VALUES ($1::uuid, $2::uuid, 0, 'T', 'amrap', 720)`,
          s,
          w,
        );
        await addRound(s, 1, 100);
        await addRound(s, 2, 200);
        expect(await count(s)).toBe(2);
        if (target === "section") await sql(`DELETE FROM "workout_section" WHERE id = $1::uuid`, s);
        else await sql(`DELETE FROM "workout" WHERE id = $1::uuid`, w);
        expect(await count(s)).toBe(0);
      }
    });
  });

  describe("09.5 AC4 — legal shapes accepted", () => {
    it.each([
      ["routine_section", `timer_format = 'set_timer', timer_round_s = 300, timer_rounds = 5`],
      ["routine_section", `timer_format = 'set_timer', timer_round_s = 3600, timer_rounds = 100`],
      ["routine_section", `timer_format = 'amrap', timer_cap_s = 720`],
      ["routine_section", `timer_format = 'time_cap', timer_cap_s = 10800`],
      ["routine_section", `timer_format = 'time_cap'`],
      ["workout_section", `timer_format = 'set_timer', timer_round_s = 1, timer_rounds = 1`],
      ["workout_section", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 0, result_reps = 0`],
      ["workout_section", `timer_format = 'amrap', timer_cap_s = 720, result_rounds = 999, result_reps = 9999`],
      ["workout_section", `timer_format = 'time_cap', timer_cap_s = 900, result_finish_s = 900`],
      ["workout_section", `timer_format = 'time_cap', timer_cap_s = 900, result_capped = true, result_reps = 7`],
      ["workout_section", `timer_format = 'time_cap', timer_cap_s = 900, result_capped = true, result_rounds = 4`],
      ["workout_section", `timer_format = 'time_cap', result_finish_s = 10800`],
      ["workout_section", `timer_format = 'time_cap', timer_cap_s = 900`],
    ] as const)("%s: %s", async (table, set) => {
      await reset();
      await setRow(table, set);
      await reset();
    });
  });

  it("09.5 AC34 — assertSectionsConsistent rejects a round row the CHECKs cannot see (control)", async () => {
    await reset();
    // Allowed by the database (the rule is cross-table): a round row on an untimed section.
    await sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 1, 60)`, workoutSection);
    await expect(assertSectionsConsistent(db)).rejects.toThrow(/round rows on an untimed section/);
    await reset();
    // A Set Timer row past the planned rounds and longer than the round.
    await setRow("workout_section", `timer_format = 'set_timer', timer_round_s = 300, timer_rounds = 2`);
    await sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 3, 301)`, workoutSection);
    await expect(assertSectionsConsistent(db)).rejects.toThrow(/Set Timer round rows outside the plan/);
    await reset();
    // AMRAP readings past the cap, then not increasing.
    await setRow("workout_section", `timer_format = 'amrap', timer_cap_s = 600`);
    await sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 1, 601)`, workoutSection);
    await expect(assertSectionsConsistent(db)).rejects.toThrow(/readings past the cap/);
    await sql(`DELETE FROM "workout_section_round"`);
    await sql(`INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds) VALUES ($1::uuid, 1, 300), ($1::uuid, 2, 300)`, workoutSection);
    await expect(assertSectionsConsistent(db)).rejects.toThrow(/not strictly increasing/);
    await reset();
    await assertSectionsConsistent(db);
  });
});
