import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { lineageRangeSql } from "../../src/repositories/personal-record.prisma.js";

describe("AC15 — loadLineageSets' range fragment", () => {
  it("no range ⇒ Prisma.empty, so recomputeRecordsForRoots runs the same statement as before", () => {
    expect(lineageRangeSql({})).toBe(Prisma.empty);
    expect(lineageRangeSql({ from: undefined, to: undefined })).toBe(Prisma.empty);
  });
  it("from / to ⇒ bound, inclusive local_date predicates (never concatenated)", () => {
    const both = lineageRangeSql({ from: "2026-09-01", to: "2026-09-30" });
    expect(both.sql).toContain("w.local_date >= ");
    expect(both.sql).toContain("w.local_date <= ");
    expect(both.values).toEqual(["2026-09-01", "2026-09-30"]);
    expect(lineageRangeSql({ from: "2026-09-01" }).values).toEqual(["2026-09-01"]);
    expect(lineageRangeSql({ to: "2026-09-30" }).sql).not.toContain(">=");
  });
});
