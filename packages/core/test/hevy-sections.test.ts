import { describe, expect, it } from "vitest";
import { SECTION_DEFAULT_RULES, sectionFromPlaceholder, sectionKey, sectionTreatment } from "../src/index.js";

describe("19.0 AC10 — section treatment", () => {
  it("the defaults: Warm-up gets a marker, Accessory goes on the first exercise", () => {
    expect(SECTION_DEFAULT_RULES).toEqual([
      { name: "Warm-up", treatment: "warmup_placeholder" },
      { name: "Accessory", treatment: "notes_on_first" },
    ]);
  });

  it.each([
    ["  warm-UP ", "warmup_placeholder"],
    ["Warm-up", "warmup_placeholder"],
    ["ACCESSORY", "notes_on_first"],
    ["Finisher", "workout_placeholder"],
  ] as const)("Review Focus 3: %j with no user rules is %s", (name, treatment) => {
    expect(sectionTreatment(name, [])).toBe(treatment);
  });

  it("a user rule beats the default, matched on the trimmed lowercase name", () => {
    expect(sectionTreatment("Accessory", [{ name: "accessory ", treatment: "workout_placeholder" }])).toBe("workout_placeholder");
  });

  it("sectionKey trims and lowercases", () => {
    expect(sectionKey("  Warm-UP ")).toBe("warm-up");
  });
});

describe("19.0 AC10 — sections from Hevy placeholders", () => {
  it("a warm-up placeholder starts Warm-up with its notes as the section note", () => {
    expect(sectionFromPlaceholder("warmup_placeholder", "Easy row")).toEqual({ name: "Warm-up", note: "Easy row", notices: [] });
  });

  it("a workout placeholder is named by its first line; the rest, trimmed, is the note", () => {
    expect(sectionFromPlaceholder("workout_placeholder", " EMOM 12 \n  every minute \n row ")).toEqual({
      name: "EMOM 12",
      note: "every minute\nrow",
      notices: [],
    });
  });

  it.each([null, "", "   \n  "])("a workout placeholder with notes %j is Workout, no note", (notes) => {
    expect(sectionFromPlaceholder("workout_placeholder", notes)).toEqual({ name: "Workout", note: null, notices: [] });
  });

  it("a warm-up placeholder with no notes has no note", () => {
    expect(sectionFromPlaceholder("warmup_placeholder", null)).toEqual({ name: "Warm-up", note: null, notices: [] });
  });

  it("a 50-character name is cut to 40", () => {
    const r = sectionFromPlaceholder("workout_placeholder", "x".repeat(50));
    expect(r.name).toHaveLength(40);
    expect(r.notices).toEqual(["section_name_cut"]);
  });

  it("a 2,100-character note is cut to 2000", () => {
    const r = sectionFromPlaceholder("warmup_placeholder", "y".repeat(2100));
    expect(r.note).toHaveLength(2000);
    expect(r.notices).toEqual(["section_note_cut"]);
  });
});
