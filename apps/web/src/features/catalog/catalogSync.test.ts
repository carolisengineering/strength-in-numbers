import { describe, expect, it } from "vitest";

import { ApiError } from "../../api/problem";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { classifySyncFailure, mergeCatalogRows } from "./catalogSync";

const apiError = (status: number) =>
  new ApiError({ status, type: "about:blank", title: `HTTP ${status}`, requestId: "req-test" });

describe("AC2 — mergeCatalogRows merges a delta by id", () => {
  const squat = makeExercise({ id: exerciseId(1), name: "Back Squat" });
  const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });

  it("keeps untouched rows, overlays changed rows, and adds new ones", () => {
    const renamed = makeExercise({ id: exerciseId(2), name: "Paused Bench Press" });
    const row = makeExercise({ id: exerciseId(3), name: "Barbell Row" });

    const merged = mergeCatalogRows([squat, bench], [renamed, row]);

    expect(merged.map((r) => r.name).sort()).toEqual([
      "Back Squat",
      "Barbell Row",
      "Paused Bench Press",
    ]);
  });

  it("removes a row the delta marks isActive: false", () => {
    const retired = makeExercise({ id: exerciseId(2), isActive: false });

    expect(mergeCatalogRows([squat, bench], [retired])).toEqual([squat]);
  });

  it("ignores a tombstone for a row that was never stored", () => {
    const retired = makeExercise({ id: exerciseId(9), isActive: false });

    expect(mergeCatalogRows([squat], [retired])).toEqual([squat]);
  });

  it("does not mutate either input", () => {
    const stored = [squat];
    const incoming = [bench];

    mergeCatalogRows(stored, incoming);

    expect(stored).toEqual([squat]);
    expect(incoming).toEqual([bench]);
  });
});

describe("AC3 — classifySyncFailure maps a thrown value to an outcome", () => {
  it("410 and 422 are resets that carry their reason", () => {
    expect(classifySyncFailure(apiError(410))).toEqual({ kind: "reset", reason: "410" });
    expect(classifySyncFailure(apiError(422))).toEqual({ kind: "reset", reason: "422" });
  });

  it.each([
    ["a network failure", ApiError.network("req-test", new TypeError("offline"))],
    ["a 500", apiError(500)],
    ["a 401", apiError(401)],
    ["a 404", apiError(404)],
    ["a non-ApiError value", new Error("boom")],
    ["a non-error value", "nope"],
  ])("%s is transient", (_label, error) => {
    expect(classifySyncFailure(error)).toEqual({ kind: "transient" });
  });
});
