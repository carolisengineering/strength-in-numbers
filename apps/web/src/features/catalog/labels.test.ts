import { describe, expect, it } from "vitest";
import { CREATABLE_MODALITIES, MODALITY_LABELS } from "./labels";

describe("05.3 AC21 — the create form offers only the legacy five", () => {
  it("CREATABLE_MODALITIES is the legacy five, in order", () => {
    expect([...CREATABLE_MODALITIES]).toEqual(["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"]);
  });
  it("MODALITY_LABELS covers the three new values", () => {
    expect(MODALITY_LABELS.calories).toBe("Calories");
    expect(MODALITY_LABELS.weight_distance).toBe("Weight + distance");
    expect(MODALITY_LABELS.weight_duration).toBe("Weight + duration");
  });
});
