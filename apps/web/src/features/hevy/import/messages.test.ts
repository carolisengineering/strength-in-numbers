import { describe, expect, it } from "vitest";
import { HEVY_IMPORT_DROP_CODES, HEVY_IMPORT_NOTICE_CODES, HEVY_IMPORT_OUTCOME_VALUES, HEVY_ROUTINE_NOTICE_CODES } from "@sin/core";

import { DROP_LABELS, NOTICE_LABELS, OUTCOME_LABELS, ROUTINE_NOTICE_LABELS, UNREADABLE_LABEL } from "./messages";

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
