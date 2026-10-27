import { describe, expect, it } from "vitest";
import { normalizeExportAs, type HevyPair } from "../src/index.js";

const p = (hevyTemplateId: string, exerciseId: string | null, exportAs: boolean, role: HevyPair["role"] = "exercise") => ({
  hevyTemplateId,
  role,
  exerciseId,
  exportAs,
});

describe("19.0 AC15 — normalizeExportAs", () => {
  it("none marked: the first pair of each exercise is chosen", () => {
    const out = normalizeExportAs([p("A", "x", false), p("B", "x", false), p("C", "y", false)]);
    expect(out.map((q) => [q.hevyTemplateId, q.exportAs])).toEqual([["A", true], ["B", false], ["C", true]]);
  });

  it("two marked: the first marked is kept", () => {
    const out = normalizeExportAs([p("A", "x", false), p("B", "x", true), p("C", "x", true)]);
    expect(out.map((q) => q.exportAs)).toEqual([false, true, false]);
  });

  it("a pair that is not an exercise is never exportAs", () => {
    const out = normalizeExportAs([p("S", null, true, "skip"), p("W", null, true, "warmup_placeholder")]);
    expect(out.map((q) => q.exportAs)).toEqual([false, false]);
  });

  it("is idempotent and does not mutate its input", () => {
    const input = [p("A", "x", false), p("B", "x", true), p("C", "x", true), p("S", null, true, "skip")];
    const before = structuredClone(input);
    const once = normalizeExportAs(input);
    expect(normalizeExportAs(once)).toEqual(once);
    expect(input).toEqual(before);
  });

  it("keeps the other fields of a wider pair", () => {
    const out = normalizeExportAs([{ ...p("A", "x", false), hevyTitle: "Bench" }]);
    expect(out[0]).toEqual({ hevyTemplateId: "A", role: "exercise", exerciseId: "x", exportAs: true, hevyTitle: "Bench" });
  });
});
