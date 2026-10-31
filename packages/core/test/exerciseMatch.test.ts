import { describe, expect, it, vi } from "vitest";
import { guessModality, matchExerciseName, normalizeExerciseName, prepareCatalog, type PreparedCatalog } from "../src/exerciseMatch.js";
import { prng } from "./helpers/history-generator.js";

const BUILT_INS = ["Barbell back squat", "Barbell bench press", "Conventional deadlift", "Overhead press", "Barbell row", "Dumbbell lunge",
  "Pull-up", "Weighted dip", "Plank", "Treadmill run"].map((name, i) => ({ id: `g${i + 1}`, name, ownerUserId: null }));

describe("10.4 AC14 — normalization and exact match", () => {
  it.each([
    ["Hand release pushups", "Hand-release push-up"], ["Presses", "press"], ["Raises", "raise"], ["Boxes", "box"],
    ["Pull-Ups", "pull up"], ["- Café Squats", "cafe squat"], ["Push  Press", "push-press"],
  ])("%s ≡ %s", (a, b) => expect(normalizeExerciseName(a)).toBe(normalizeExerciseName(b)));
  it.each([["Press", "press"], ["Abs", "abs"], ["Pass", "pass"], ["Hand release pushups", "handreleasepushup"]])("%s → %s", (a, key) => expect(normalizeExerciseName(a)).toBe(key));
  it("a name with no letter or digit has the empty key", () => expect(normalizeExerciseName("- • !")).toBe(""));
  it("an exact key match", () => expect(matchExerciseName("pull ups", BUILT_INS)).toEqual({ kind: "exact", row: BUILT_INS[6] }));
  it("ties: the custom row wins, then the lowest name", () => {
    const rows = [{ id: "a", name: "Push press", ownerUserId: null }, { id: "b", name: "Push-Press", ownerUserId: "u" }, { id: "c", name: "Push Press", ownerUserId: "u" }];
    expect(matchExerciseName("push presses", rows)).toEqual({ kind: "exact", row: rows[2] });
  });
});

describe("10.4 AC15 — at most one similar suggestion, tuned on the built-ins", () => {
  it.each([["Strict Press", "Overhead press"], ["DB Lateral Lunge", "Dumbbell lunge"], ["400 Meter Run", "Treadmill run"]])("%s → %s", (w, name) => expect(matchExerciseName(w, BUILT_INS)).toMatchObject({ kind: "similar", row: { name } }));
  it.each(["Power Clean", "Hand Release Pushups", "Front Raise", "Reverse Fly"])("%s → none", (w) => expect(matchExerciseName(w, BUILT_INS)).toEqual({ kind: "none" }));
  it("kb / bb expand", () => expect(matchExerciseName("KB Swing", [{ id: "k", name: "Kettlebell swing", ownerUserId: null }])).toMatchObject({ kind: "exact" }));
  it("ties: shorter name, then alphabetical; deterministic", () => {
    const rows = [{ id: "1", name: "Zed press", ownerUserId: null }, { id: "2", name: "Ab press", ownerUserId: null }];
    expect(matchExerciseName("Strict Press", rows)).toMatchObject({ row: { id: "2" } });
    expect(matchExerciseName("Strict Press", [...rows].reverse())).toMatchObject({ row: { id: "2" } });
  });
  it("a possessive 's leaves no empty word: Farmer's Carry ≡ Farmers Carry, and apostrophes share nothing", () => {
    expect(normalizeExerciseName("Farmer's Carry")).toBe(normalizeExerciseName("Farmers Carry"));
    expect(matchExerciseName("Bob's Lift", [{ id: "w", name: "Tom's Jump", ownerUserId: null }])).toEqual({ kind: "none" });
    expect(matchExerciseName("Bob's", [{ id: "w", name: "Tom's", ownerUserId: null }])).toEqual({ kind: "none" });
  });
  it("a name of only numbers and units has no tokens → none", () => expect(matchExerciseName("400 m", BUILT_INS)).toEqual({ kind: "none" }));
});

describe("10.4 AC16 — guessModality", () => {
  it.each([
    ["Strict Press", "weight_reps"], ["Power Clean", "weight_reps"], ["Hand Release Pushups", "bodyweight_reps"], ["Push Press", "weight_reps"],
    ["400 Meter Run", "distance_duration"], ["Front Raise", "weight_reps"], ["Reverse Fly", "weight_reps"], ["DB Lateral Lunge", "weight_reps"],
    ["1 Mile Run", "distance_duration"], ["400m Row", "distance_duration"], ["Bike Erg", "distance_duration"], ["Swim", "distance_duration"],
    ["Plank", "duration"], ["Wall Sit", "duration"], ["Dead Hang", "duration"], ["Hollow Hold", "duration"],
    ["Pull-ups", "bodyweight_reps"], ["Chin Up", "bodyweight_reps"], ["Sit-ups", "bodyweight_reps"], ["Burpees", "bodyweight_reps"], ["Push ups", "bodyweight_reps"],
    ["Hang Power Clean", "weight_reps"], ["Hang Muscle Cleans", "weight_reps"],
  ])("%s → %s", (name, m) => expect(guessModality(name)).toBe(m));
});

describe("Minor 18 — a prepared catalog", () => {
  const WORDS = ["Barbell", "DB", "Dumbbell", "KB", "Kettlebell", "Bench", "Press", "Squat", "Front", "Back", "Split", "Lunge", "Row",
    "Curl", "Hammer", "Incline", "Pull-up", "Push-ups", "Deadlift", "Romanian", "Walking", "Café", "Cable", "Raises", "Run", "400m"];
  const nameFrom = (rnd: () => number) => Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => WORDS[Math.floor(rnd() * WORDS.length)]!).join(" ");
  const rnd = prng(18);
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: `r${i}`, name: nameFrom(rnd), ownerUserId: i % 3 === 0 ? "u1" : null }));
  // Half copies of row names with a case or plural twist, half fresh combinations.
  const names = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? `${rows[i * 5]!.name.toUpperCase()}s` : nameFrom(rnd)));

  it("matches like the rows, name by name", () => {
    const catalog = prepareCatalog(rows);
    for (const n of names) expect(matchExerciseName(n, catalog), n).toEqual(matchExerciseName(n, rows));
    expect(names.some((n) => matchExerciseName(n, rows).kind === "exact")).toBe(true);
    expect(names.some((n) => matchExerciseName(n, rows).kind === "similar")).toBe(true);
  });

  it("prepared once, each row and each name is normalized once", () => {
    const normalize = vi.spyOn(String.prototype, "normalize");
    try {
      const catalog = prepareCatalog(rows);
      for (const n of names) matchExerciseName(n, catalog);
      expect(normalize.mock.calls.length).toBeLessThanOrEqual(rows.length + names.length);
    } finally {
      normalize.mockRestore();
    }
  });

  it("Minor 221 — a hand-made object is not trusted as a prepared catalog", () => {
    const fake = { entries: [] } as unknown as PreparedCatalog<(typeof rows)[number]>;
    expect(() => matchExerciseName(rows[0]!.name, fake)).toThrow();
    expect(matchExerciseName(rows[0]!.name, prepareCatalog(rows)).kind).toBe("exact");
  });

  it("Review Focus 5 — a catalog prepared from new rows finds the new exercise", () => {
    const before = prepareCatalog(rows);
    const added = { id: "new", name: "Zercher Carry", ownerUserId: "u1" };
    expect(matchExerciseName("Zercher Carry", before)).toEqual({ kind: "none" });
    expect(matchExerciseName("Zercher Carry", prepareCatalog([...rows, added]))).toEqual({ kind: "exact", row: added });
  });
});
