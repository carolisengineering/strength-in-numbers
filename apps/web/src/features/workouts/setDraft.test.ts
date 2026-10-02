import { describe, expect, it } from "vitest";
import { MODALITY_VALUES, SET_REPS_MAX, SetEntrySchema, type SetEntry } from "@sin/core";
import {
  createDraftReducer,
  diffForPatch,
  draftFromSet,
  parseDraft,
  unitDefaultsFor,
  type SetBody,
  type SetDraft,
} from "./setDraft";

const base = (o: Partial<SetDraft> = {}): SetDraft => ({
  weight: "",
  reps: "",
  distance: "",
  minutes: "",
  seconds: "",
  rpe: "",
  weightUnit: "kg",
  distanceUnit: "km",
  setType: "working",
  attemptKey: "k1",
  ...o,
});

const set = (o: Record<string, unknown> = {}): SetEntry =>
  SetEntrySchema.parse({
    id: "00000000-0000-4000-8000-000000000001",
    workoutExerciseId: "00000000-0000-4000-8000-000000000002",
    clientGeneratedId: null,
    setNumber: 1,
    setType: "working",
    reps: 8,
    weight: 60,
    weightUnit: "kg",
    weightKg: 60,
    distance: null,
    distanceUnit: null,
    distanceM: null,
    durationS: null,
    rpe: null,
    isComplete: true,
    completedAt: "2026-10-02T10:00:00.000Z",
    createdAt: "2026-10-02T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    ...o,
  });

const errorsOf = (r: ReturnType<typeof parseDraft>) => (r.ok ? {} : r.errors);

describe("AC6 — parseDraft", () => {
  it("weight_reps: trimmed comma decimal; exactly the visible measures + unit + setType", () => {
    expect(parseDraft("weight_reps", base({ weight: " 52,5 ", reps: "8" }))).toEqual({
      ok: true,
      body: { setType: "working", weight: 52.5, weightUnit: "kg", reps: 8 },
    });
  });

  it("accepts reps 0 and weight 0 (a failed attempt, 05.1 D14)", () => {
    expect(parseDraft("weight_reps", base({ weight: "0", reps: "0" })).ok).toBe(true);
  });

  it("bodyweight_reps carries no weight; duration sums minutes and seconds", () => {
    expect(parseDraft("bodyweight_reps", base({ reps: "12" }))).toEqual({
      ok: true,
      body: { setType: "working", reps: 12 },
    });
    expect(parseDraft("duration", base({ minutes: "1", seconds: "30" }))).toEqual({
      ok: true,
      body: { setType: "working", durationS: 90 },
    });
  });

  it("duration accepts seconds alone", () => {
    expect(parseDraft("duration", base({ seconds: "45" }))).toEqual({
      ok: true,
      body: { setType: "working", durationS: 45 },
    });
  });

  it("distance_duration carries distance + unit + duration; rejects metres beyond the bound", () => {
    expect(
      parseDraft("distance_duration", base({ distance: "5", distanceUnit: "km", minutes: "25" })),
    ).toEqual({
      ok: true,
      body: { setType: "working", distance: 5, distanceUnit: "km", durationS: 1500 },
    });
    expect(
      errorsOf(parseDraft("distance_duration", base({ distance: "999999", distanceUnit: "km", minutes: "1" })))
        .distance,
    ).toBe("Too large");
  });

  it.each([
    ["", "Required"],
    ["abc", "Enter a number"],
    ["-1", "Can't be negative"],
    ["1 000", "Enter a number"],
    ["٣", "Enter a number"],
    ["1.2345", "Use up to 3 decimal places"],
    ["10000", "Too large"],
  ])("weight %j → %s, and the message never echoes the input", (weight, message) => {
    const r = parseDraft("weight_reps", base({ weight, reps: "8" }));
    expect(errorsOf(r).weight).toBe(message);
    if (weight !== "") expect(errorsOf(r).weight).not.toContain(weight);
  });

  it("reps: decimal and over-max rejected", () => {
    expect(errorsOf(parseDraft("weight_reps", base({ weight: "1", reps: "8.5" }))).reps).toBe("Enter a whole number");
    expect(errorsOf(parseDraft("weight_reps", base({ weight: "1", reps: String(SET_REPS_MAX + 1) }))).reps).toBe(
      "Too large",
    );
  });

  it("seconds above 59 rejected", () => {
    expect(errorsOf(parseDraft("duration", base({ minutes: "1", seconds: "60" }))).seconds).toBe(
      "Seconds must be 0–59",
    );
  });

  it("an empty duration is required", () => {
    expect(errorsOf(parseDraft("duration", base())).minutes).toBe("Required");
  });

  it("RPE: bounds and one decimal; included only when non-empty", () => {
    const d = { weight: "1", reps: "1" };
    expect(errorsOf(parseDraft("weight_reps", base({ ...d, rpe: "11" }))).rpe).toBe("RPE must be 1–10");
    expect(errorsOf(parseDraft("weight_reps", base({ ...d, rpe: "0.5" }))).rpe).toBe("RPE must be 1–10");
    expect(errorsOf(parseDraft("weight_reps", base({ ...d, rpe: "8.55" }))).rpe).toBe("RPE must be 1–10");
    const ok = parseDraft("weight_reps", base({ ...d, rpe: "8,5" }));
    expect(ok.ok && ok.body.rpe).toBe(8.5);
    const none = parseDraft("weight_reps", base(d));
    expect(none.ok && "rpe" in none.body).toBe(false);
  });

  it.each(MODALITY_VALUES)("%s never emits a measure the modality forbids", (modality) => {
    const r = parseDraft(modality, base({ weight: "1", reps: "1", distance: "1", minutes: "1" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const keys = Object.keys(r.body);
    const forbidden: Record<string, string[]> = {
      weight_reps: ["durationS", "distance", "distanceUnit"],
      bodyweight_reps: ["weight", "weightUnit", "durationS", "distance", "distanceUnit"],
      weighted_bodyweight: ["durationS", "distance", "distanceUnit"],
      duration: ["weight", "weightUnit", "reps", "distance", "distanceUnit"],
      distance_duration: ["weight", "weightUnit", "reps"],
    };
    expect(keys.filter((k) => forbidden[modality]!.includes(k))).toEqual([]);
  });
});

describe("AC7 — diffForPatch", () => {
  const body = (o: Partial<SetBody> = {}): SetBody => ({
    setType: "working",
    weight: 60,
    weightUnit: "kg",
    reps: 8,
    ...o,
  });

  it("weight-only edit → { weight }", () => {
    expect(diffForPatch(set(), body({ weight: 62.5 }))).toEqual({ weight: 62.5 });
  });
  it("unit-only edit → { weightUnit }", () => {
    expect(diffForPatch(set(), body({ weightUnit: "lb" }))).toEqual({ weightUnit: "lb" });
  });
  it("reps and set type edits are diffed", () => {
    expect(diffForPatch(set(), body({ reps: 9, setType: "drop" }))).toEqual({ reps: 9, setType: "drop" });
  });
  it("cleared RPE → { rpe: null }", () => {
    expect(diffForPatch(set({ rpe: 8 }), body())).toEqual({ rpe: null });
  });
  it("a changed RPE is sent", () => {
    expect(diffForPatch(set({ rpe: 8 }), body({ rpe: 9 }))).toEqual({ rpe: 9 });
  });
  it("no change → null", () => {
    expect(diffForPatch(set(), body())).toBeNull();
  });
  it("never includes isComplete, clientGeneratedId or an unrelated measure", () => {
    const d = diffForPatch(set(), body({ weight: 1, reps: 1, setType: "drop" })) ?? {};
    expect(Object.keys(d).sort()).toEqual(["reps", "setType", "weight"]);
  });
});

describe("AC10 — attempt key lifecycle", () => {
  it("is retained across edits and re-minted only after a logged set", () => {
    let n = 0;
    const reduce = createDraftReducer(() => `key-${++n}`);
    const d0 = base({ attemptKey: "key-0" });
    const edited = reduce(d0, { type: "edit", field: "weight", value: "61" });
    expect(edited.attemptKey).toBe("key-0");
    const twice = reduce(edited, { type: "edit", field: "reps", value: "9" });
    expect(twice.attemptKey).toBe("key-0");
    const logged = reduce(twice, { type: "logged", set: set({ weight: 61, reps: 9 }) });
    expect(logged.attemptKey).toBe("key-1");
    expect(logged.weight).toBe("61"); // copy-forward
    expect(logged.setType).toBe("working"); // type reset to Working
  });

  it("does not copy RPE forward and keeps the entered units", () => {
    const reduce = createDraftReducer(() => "k");
    const d = base({ weightUnit: "lb" });
    const next = reduce(d, { type: "logged", set: set({ rpe: 9, weight: 135, weightUnit: "lb" }) });
    expect(next.rpe).toBe("");
    expect(next.weightUnit).toBe("lb");
  });

  it("reset re-initialises from a set (or empty) with a fresh key", () => {
    const reduce = createDraftReducer(() => "fresh");
    const next = reduce(base({ weight: "99" }), { type: "reset", from: null, defaults: unitDefaultsFor("lb") });
    expect(next).toMatchObject({ weight: "", weightUnit: "lb", distanceUnit: "mi", attemptKey: "fresh" });
  });
});

describe("draftFromSet / unit defaults", () => {
  it("kg → km and lb → mi (D26)", () => {
    expect(unitDefaultsFor("kg")).toEqual({ weightUnit: "kg", distanceUnit: "km" });
    expect(unitDefaultsFor("lb")).toEqual({ weightUnit: "lb", distanceUnit: "mi" });
  });
  it("null → empty draft with the preferred units", () => {
    expect(draftFromSet(null, unitDefaultsFor("lb"), "k")).toMatchObject({
      weight: "",
      reps: "",
      weightUnit: "lb",
      distanceUnit: "mi",
      setType: "working",
      attemptKey: "k",
    });
  });
  it("splits durationS into minutes and seconds and keeps the set's own units", () => {
    const d = draftFromSet(
      set({ durationS: 125, weight: null, weightUnit: null, reps: null, distance: 2, distanceUnit: "m" }),
      unitDefaultsFor("kg"),
      "k",
    );
    expect([d.minutes, d.seconds]).toEqual(["2", "5"]);
    expect(d.distanceUnit).toBe("m");
    expect(d.weightUnit).toBe("kg"); // set has none → the default
  });
  it("fills partial sets with empty strings (null ≠ 0)", () => {
    expect(draftFromSet(set({ weight: null, weightUnit: null, reps: 0 }), unitDefaultsFor("kg"), "k")).toMatchObject({
      weight: "",
      reps: "0",
    });
  });
});
