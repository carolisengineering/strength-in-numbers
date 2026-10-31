import { describe, expect, it } from "vitest";
import { HEVY_IMPORT_DROP_CODES, HEVY_IMPORT_NOTICE_CODES, HEVY_IMPORT_OUTCOME_VALUES, HEVY_ROUTINE_NOTICE_CODES } from "@sin/core";

import { DROP_LABELS, NOTICE_LABELS, OUTCOME_LABELS, ROUTINE_NOTICE_LABELS, summaryCountLine, UNREADABLE_LABEL } from "./messages";

describe("20.1 AC12 — every code has one label", () => {
  it.each([
    ["outcomes", HEVY_IMPORT_OUTCOME_VALUES, OUTCOME_LABELS],
    ["drops", HEVY_IMPORT_DROP_CODES, DROP_LABELS],
    ["notices", HEVY_IMPORT_NOTICE_CODES, NOTICE_LABELS],
    ["routine notices", HEVY_ROUTINE_NOTICE_CODES, ROUTINE_NOTICE_LABELS],
  ] as const)("%s: a non-empty label per code and no extra keys", (_name, codes, labels) => {
    expect(Object.keys(labels).sort()).toEqual([...codes].sort());
    for (const code of codes) expect((labels as Record<string, string>)[code]?.trim()).toBeTruthy();
  });

  it("the unreadable label is not empty", () => {
    expect(UNREADABLE_LABEL.trim()).toBeTruthy();
  });
});

describe("Minor 248 — one duplicate in the singular", () => {
  it("1 already matches; many already match", () => {
    expect(summaryCountLine("duplicate", 1)).toBe("1 already matches a workout in SIN (it'll be linked, not copied)");
    expect(summaryCountLine("duplicate", 41)).toBe("41 already match a workout in SIN (they'll be linked, not copied)");
  });

  it("the other lines read the same for one", () => {
    expect(summaryCountLine("create", 1)).toBe("1 will be imported");
    expect(summaryCountLine("cannotImport", 1_013)).toBe("1,013 can't be imported");
  });
});
