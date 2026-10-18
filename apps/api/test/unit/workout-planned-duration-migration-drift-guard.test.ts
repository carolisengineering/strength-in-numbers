import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKOUT_DURATION_MAX_S } from "@sin/core";

const sql = readFileSync(
  new URL("../../prisma/migrations/0012_workout_planned_duration/migration.sql", import.meta.url),
  "utf8",
);

describe("07.4 AC18 — migration 0012's literal cannot silently drift from @sin/core", () => {
  it("the range CHECK renders WORKOUT_DURATION_MAX_S", () => {
    expect(sql).toContain(`CONSTRAINT "workout_planned_duration_range"`);
    expect(sql).toContain(`"planned_duration_s" <= ${WORKOUT_DURATION_MAX_S}`);
  });
  it("the live-only CHECK ties a plan to an unfinished row", () => {
    expect(sql).toContain(`CONSTRAINT "workout_planned_duration_live_only"`);
    expect(sql).toContain(`CHECK ("planned_duration_s" IS NULL OR "ended_at" IS NULL)`);
  });
});
