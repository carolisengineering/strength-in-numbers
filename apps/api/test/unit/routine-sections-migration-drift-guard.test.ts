import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ROUTINE_SECTIONS_MAX, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "@sin/core";

const sql = readFileSync(
  new URL("../../prisma/migrations/0011_create_routine_sections/migration.sql", import.meta.url),
  "utf8",
);

describe("AC20 — the migration's literals cannot silently drift from @sin/core", () => {
  it.each(["routine_section", "workout_section"])("%s CHECKs render the core limits", (table) => {
    expect(sql).toContain(`CONSTRAINT "${table}_position_check" CHECK ("position" BETWEEN 0 AND ${ROUTINE_SECTIONS_MAX - 1})`);
    expect(sql).toContain(`CONSTRAINT "${table}_name_check" CHECK (char_length("name") BETWEEN 1 AND ${SECTION_NAME_MAX} AND "name" = btrim("name"))`);
    expect(sql).toContain(`CONSTRAINT "${table}_notes_check" CHECK ("notes" IS NULL OR char_length("notes") BETWEEN 1 AND ${SECTION_NOTES_MAX})`);
  });
  it("the workout snapshot CHECK renders the notes limit", () => {
    expect(sql).toContain(`char_length("routine_notes_snapshot") BETWEEN 1 AND ${SECTION_NOTES_MAX}`);
  });
});
