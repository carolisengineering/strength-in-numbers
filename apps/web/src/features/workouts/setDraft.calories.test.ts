import { describe, expect, it } from "vitest";
import { forbiddenMeasuresFor, MODALITY_VALUES, SET_CALORIES_MAX, type MeasureName, type Modality } from "@sin/core";
import { makeSet } from "../../test/workoutFixtures";
import { createDraftReducer, diffForPatch, draftFieldForPath, draftFromSet, parseDraft, seedDraft, type SetDraft } from "./setDraft";

const KG = { weightUnit: "kg", distanceUnit: "km" } as const;
const draft = (o: Partial<SetDraft> = {}): SetDraft => ({ ...draftFromSet(null, KG, "k1"), ...o });
const FULL: Partial<SetDraft> = { weight: "24", reps: "8", distance: "40", minutes: "1", seconds: "30", calories: "20" };
/** The body key each measure is sent as (units travel with their value). */
const KEYS: Record<MeasureName, string[]> = {
  weight: ["weight", "weightUnit"],
  reps: ["reps"],
  distance: ["distance", "distanceUnit"],
  durationS: ["durationS"],
  calories: ["calories"],
};

describe("18.1 AC10 — parseDraft per type", () => {
  it("calories: a whole number is the only measure sent", () => {
    expect(parseDraft("calories", draft({ calories: "20" }))).toEqual({ ok: true, body: { setType: "working", calories: 20 } });
    expect(parseDraft("calories", draft({ calories: String(SET_CALORIES_MAX) }))).toMatchObject({ ok: true, body: { calories: SET_CALORIES_MAX } });
  });
  it.each([
    ["", "Required"],
    ["2.5", "Enter a whole number"],
    ["-1", "Can't be negative"],
    [String(SET_CALORIES_MAX + 1), "Too large"],
  ])("calories %j → %s", (raw, message) => {
    expect(parseDraft("calories", draft({ calories: raw }))).toEqual({ ok: false, errors: { calories: message } });
  });
  it("weight_distance sends exactly weight, weightUnit, distance, distanceUnit", () => {
    const r = parseDraft("weight_distance", draft({ ...FULL, distanceUnit: "m" }));
    expect(r).toEqual({ ok: true, body: { setType: "working", weight: 24, weightUnit: "kg", distance: 40, distanceUnit: "m" } });
  });
  it("weight_duration sends exactly weight, weightUnit, durationS", () => {
    expect(parseDraft("weight_duration", draft(FULL))).toEqual({ ok: true, body: { setType: "working", weight: 24, weightUnit: "kg", durationS: 90 } });
  });
  const rows: [Modality, MeasureName][] = MODALITY_VALUES.flatMap((m) => forbiddenMeasuresFor(m).map((f) => [m, f] as [Modality, MeasureName]));
  it.each(rows)("%s never sends the forbidden %s, even with every field filled", (modality, forbidden) => {
    const r = parseDraft(modality, draft(FULL));
    expect(r.ok).toBe(true);
    if (r.ok) for (const key of KEYS[forbidden]) expect(r.body).not.toHaveProperty(key);
  });
  it("RPE: a valid value is sent, an invalid one is dropped without an error", () => {
    expect(parseDraft("calories", draft({ calories: "20", rpe: "8" }))).toEqual({ ok: true, body: { setType: "working", calories: 20, rpe: 8 } });
    expect(parseDraft("calories", draft({ calories: "20", rpe: "x" }))).toEqual({ ok: true, body: { setType: "working", calories: 20 } });
  });
});

describe("18.1 AC11 — the draft carries calories", () => {
  it("a new draft starts blank; a null stored value is blank, never 0", () => {
    expect(draftFromSet(null, KG, "k").calories).toBe("");
    expect(draftFromSet(makeSet(), KG, "k").calories).toBe("");
    expect(draftFromSet(makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, calories: 20 }), KG, "k").calories).toBe("20");
  });
  it("a copy-forward after a calories set pre-fills its calories; RPE stays blank", () => {
    const reduce = createDraftReducer(() => "next");
    const logged = makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, calories: 25, rpe: 8 });
    const next = reduce(draft({ calories: "25" }), { type: "logged", set: logged });
    expect(next).toMatchObject({ calories: "25", rpe: "", attemptKey: "next" });
    expect(seedDraft({ plannedSets: [], sets: [logged], defaults: KG, attemptKey: "s" })).toMatchObject({ calories: "25", rpe: "" });
  });
  it("an edit action can change calories", () => {
    expect(createDraftReducer(() => "n")(draft(), { type: "edit", field: "calories", value: "30" }).calories).toBe("30");
  });
});

describe("18.1 AC13 — server field errors", () => {
  it("a calories path lands under the Calories input; anything else stays unmatched", () => {
    expect(draftFieldForPath("body.calories")).toBe("calories");
    expect(draftFieldForPath("calories")).toBe("calories");
    expect(draftFieldForPath("caloriesX")).toBeNull();
  });
});

describe("18.1 AC21 — diffForPatch", () => {
  const stored = makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, calories: 20 });
  it("a calories change is sent; an equal value is not", () => {
    expect(diffForPatch(stored, { setType: "working", calories: 25 })).toEqual({ calories: 25 });
    expect(diffForPatch(stored, { setType: "working", calories: 20 })).toBeNull();
  });
  it("Review Focus 1 — a weight_reps weight edit sends { weight } only: no calories, no rpe", () => {
    const legacy = makeSet({ rpe: 8 });
    const r = parseDraft("weight_reps", { ...draftFromSet(legacy, KG, "edit"), weight: "62.5", calories: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(diffForPatch(legacy, r.body)).toEqual({ weight: 62.5 });
  });
});
