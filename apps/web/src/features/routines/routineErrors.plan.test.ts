import { describe, expect, it } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import type { Draft, DraftItem, DraftSet } from "./routineDraft";
import { serverIssuesFor } from "./routineErrors";

const item = (key: string, o: Partial<DraftItem> = {}): DraftItem => ({
  key, exerciseId: exerciseId(1), targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null,
  restSeconds: null, notes: null, supersetGroup: null, weight: null, weightUnit: null, plan: null, sectionKey: null, ...o,
});
const rowOf = (key: string): DraftSet => ({ key, setType: "working", repsLow: 6, repsHigh: 8, weight: 100, weightUnit: "kg" });
const draft: Draft = { name: "x", notes: "", sections: [], items: [item("a"), item("b", { plan: [rowOf("r1"), rowOf("r2")] })], dirty: true, adjusted: false, unlinkNotice: false };

describe("10.2 AC8 — a 422 maps onto the saved draft's items and rows", () => {
  it("quick-mode paths → the item's fields; plan-mode paths → the row", () => {
    const { issues, unmatched } = serverIssuesFor(
      [
        { path: "items.0.sets.0.weight", message: "server text" },
        { path: "items.1.sets.1.weight", message: "server text" },
        { path: "items.1.sets.0.repsLow", message: "server text" },
        { path: "items.0.sets", message: "server text" },
      ],
      draft,
    );
    expect(unmatched).toBe(false);
    expect(issues).toEqual([
      expect.objectContaining({ scope: "item", itemKey: "a", field: "weight" }),
      expect.objectContaining({ scope: "row", itemKey: "b", rowKey: "r2", field: "weight" }),
      expect.objectContaining({ scope: "row", itemKey: "b", rowKey: "r1", field: "reps" }),
      expect.objectContaining({ scope: "item", itemKey: "a", field: "targetSets" }),
    ]);
    expect(JSON.stringify(issues)).not.toContain("server text");
  });
  it("a path that names nothing on screen is unmatched → the caller shows the form-level message", () => {
    const { issues, unmatched } = serverIssuesFor([{ path: "items.1.sets.9.weight", message: "m" }, { path: "weird", message: "m" }], draft);
    expect(issues).toEqual([]);
    expect(unmatched).toBe(true);
  });
  it("existing 10.0 paths still map (name, an item field)", () => {
    const { issues } = serverIssuesFor([{ path: "name", message: "m" }, { path: "items.0.restSeconds", message: "m" }], draft);
    expect(issues.map((i) => i.scope)).toEqual(["name", "item"]);
  });
});
