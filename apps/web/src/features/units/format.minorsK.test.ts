import { describe, expect, it } from "vitest";
import { formatRecordPair } from "./format";

describe("minor 478 — a kg_reps gain in a lb account follows the shown values", () => {
  it("1000 → 1000.2 kg·reps reads 2,204.6 → 2,205.1 lb, so the gain is +0.5 lb (the shown difference), not +0.4 lb", () => {
    const pair = formatRecordPair({ recordType: "best_set_volume", unit: "kg_reps", value: 1000.2, previousValue: 1000 }, "lb");
    expect(pair.gainText).toBe("+0.5 lb");
  });

  it("two values that read the same in lb are value only", () => {
    const pair = formatRecordPair({ recordType: "best_set_volume", unit: "kg_reps", value: 1000.01, previousValue: 1000 }, "lb");
    expect(pair.gainText).toBeNull();
  });
});
