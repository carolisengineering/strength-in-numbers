import { describe, expect, it } from "vitest";
import { SET_REPS_MAX, SetEntrySchema, type PlannedSet, type SetEntry } from "@sin/core";
import {
  createDraftReducer,
  diffForPatch,
  draftFieldForPath,
  draftForEdit,
  draftFromSet,
  parseDraft,
  seedDraft,
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
    calories: null,
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

  it("RPE (17.1 AC2): a valid value is sent; an invalid one is dropped, never an error; empty is absent", () => {
    const d = { weight: "1", reps: "1" };
    for (const bad of ["11", "0.5", "8.55", "abc"]) {
      const r = parseDraft("weight_reps", base({ ...d, rpe: bad }));
      expect(r.ok, bad).toBe(true);
      expect(r.ok && "rpe" in r.body, bad).toBe(false);
    }
    const ok = parseDraft("weight_reps", base({ ...d, rpe: "8,5" }));
    expect(ok.ok && ok.body.rpe).toBe(8.5);
    const none = parseDraft("weight_reps", base(d));
    expect(none.ok && "rpe" in none.body).toBe(false);
  });

  // The legacy five: the new types' drafts are Spec 18.1's (05.3 Phase A ships no entry UI for them).
  it.each(["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"] as const)("%s never emits a measure the modality forbids", (modality) => {
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
  // Spec 17.1 Phase A (AC2): RPE has no input, so an edit never sends it — neither a "cleared" null when the
  // stored value fails to round-trip through the draft, nor a different value.
  it("17.1 AC2: a body without rpe does not clear a stored RPE", () => {
    expect(diffForPatch(set({ rpe: 8 }), body())).toBeNull();
    expect(diffForPatch(set({ rpe: 8 }), body({ reps: 9 }))).toEqual({ reps: 9 });
  });
  it("17.1 AC2: an RPE in the body is never sent", () => {
    expect(diffForPatch(set({ rpe: 8 }), body({ rpe: 9 }))).toBeNull();
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

  it("rekey re-mints the key and keeps what the lifter typed meanwhile (final review I3)", () => {
    let n = 0;
    const reduce = createDraftReducer(() => `key-${++n}`);
    const typed = base({ attemptKey: "key-0", weight: "65", reps: "5", rpe: "8" });

    const next = reduce(typed, { type: "rekey" });

    expect(next).toEqual({ ...typed, attemptKey: "key-1" });
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

describe("draftFieldForPath — a server field path names an input", () => {
  it.each([
    ["weight", "weight"],
    ["weightUnit", "weight"],
    ["reps", "reps"],
    ["distance", "distance"],
    ["distanceUnit", "distance"],
    ["durationS", "minutes"],
    ["body.weight", "weight"],
    ["/reps", "reps"],
    ["sets.0.durationS", "minutes"],
  ])("%s → %s", (path, field) => {
    expect(draftFieldForPath(path)).toBe(field);
  });

  // "rpe" has no input since Spec 17.1 Phase A, so its errors fall to the form-level message.
  it.each(["isComplete", "setType", "", "body", "weights", "rpe", "/rpe"])("%j matches no input", (path) => {
    expect(draftFieldForPath(path)).toBeNull();
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
  it("#129 — copy-forward drafts a working set; draftForEdit keeps the stored type, keyed \"edit\"", () => {
    const warmup = set({ setType: "warmup", weight: 40, reps: 8 });
    expect(draftFromSet(warmup, KG, "k").setType).toBe("working");
    expect(draftForEdit(warmup, KG)).toEqual({ ...draftFromSet(warmup, KG, "edit"), setType: "warmup" });
  });
});

const planRow = (o: Partial<PlannedSet> = {}): PlannedSet => ({ setType: "working", repsLow: 8, repsHigh: 8, weight: 80, weightUnit: "kg", ...o });
const KG = unitDefaultsFor("kg");
const seed = (plannedSets: PlannedSet[], sets: SetEntry[], defaults = KG) => seedDraft({ plannedSets, sets, defaults, attemptKey: "k1" });

describe("10.2 AC22 — seedDraft overlays the next planned row on today's copy-forward", () => {
  it("the first set, nothing logged: a fully specified row fills type, reps, weight and unit; RPE blank", () => {
    expect(seed([planRow({ setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60 })], [])).toEqual(
      base({ setType: "warmup", reps: "10", weight: "60", weightUnit: "kg", attemptKey: "k1" }),
    );
  });
  it("a reps-only row keeps the copy-forward weight and unit", () => {
    const logged = set({ weight: 60, weightUnit: "kg", reps: 8 });
    const draft = seed([planRow(), planRow({ repsLow: 5, repsHigh: 5, weight: null, weightUnit: null })], [logged]);
    expect(draft).toEqual({ ...draftFromSet(logged, KG, "k1"), reps: "5", setType: "working", rpe: "" });
    expect(draft.weight).toBe("60");
  });
  it("a weight-only row keeps the copy-forward reps", () => {
    const logged = set({ weight: 60, reps: 8 });
    const draft = seed([planRow(), planRow({ repsLow: null, repsHigh: null, weight: 82.5 })], [logged]);
    expect(draft).toMatchObject({ reps: "8", weight: "82.5", weightUnit: "kg" });
  });
  it("the plan's unit wins over the profile default, and over the last set's", () => {
    expect(seed([planRow({ weight: 135, weightUnit: "lb" })], [], KG)).toMatchObject({ weight: "135", weightUnit: "lb" });
    const loggedKg = set({ weight: 60, weightUnit: "kg" });
    expect(seed([planRow(), planRow({ weight: 135, weightUnit: "lb" })], [loggedKg])).toMatchObject({ weightUnit: "lb" });
  });
  it("a row without a weight leaves the unit to the copy-forward / the default", () => {
    expect(seed([planRow({ weight: null, weightUnit: null })], [], unitDefaultsFor("lb"))).toMatchObject({ weight: "", weightUnit: "lb" });
  });
  it("setType always comes from the row; RPE is blank even when the last set had one", () => {
    const logged = set({ rpe: 8 });
    expect(seed([planRow(), planRow({ setType: "drop" })], [logged])).toMatchObject({ setType: "drop", rpe: "" });
  });
  it("after the plan (extra) and with no plan (none) the result is draftFromSet with RPE blank (17.1 AC2)", () => {
    const logged = set({ weight: 60, reps: 8, rpe: 8 });
    // Spec 17.1 Phase A: RPE is hidden, so a new set never inherits the previous set's value.
    expect(seed([planRow()], [logged])).toEqual({ ...draftFromSet(logged, KG, "k1"), rpe: "" });
    expect(seed([], [logged])).toEqual({ ...draftFromSet(logged, KG, "k1"), rpe: "" });
    expect(seed([], [])).toEqual(draftFromSet(null, KG, "k1"));
    expect(draftFromSet(logged, KG, "k1").rpe).toBe("8"); // the edit sheet still sees the stored value
  });
  it("a null field is '' — never '0'", () => {
    const draft = seed([planRow({ repsLow: null, repsHigh: null, weight: null, weightUnit: null })], []);
    expect(draft).toMatchObject({ reps: "", weight: "" });
  });
});

describe("10.2 AC24 — the reducer reseeds from the plan", () => {
  const reduceDraft = createDraftReducer(() => "fresh");
  const PLAN = [planRow({ setType: "warmup", repsLow: 10, repsHigh: 10, weight: 60 }), planRow(), planRow({ repsLow: 6, repsHigh: 6, weight: 100 })];
  it("logged: the next draft is the next planned row (the set just logged counts)", () => {
    const first = set({ setType: "warmup", reps: 10, weight: 60 });
    expect(reduceDraft(base({ attemptKey: "old" }), { type: "logged", set: first, plannedSets: PLAN, sets: [] })).toEqual(
      base({ reps: "8", weight: "80", weightUnit: "kg", setType: "working", attemptKey: "fresh" }),
    );
  });
  it("logged after the last planned row: Extra set with today's copy-forward of the set just logged, RPE cleared", () => {
    const last = set({ reps: 6, weight: 100, rpe: 9 });
    const out = reduceDraft(base({ attemptKey: "old" }), { type: "logged", set: last, plannedSets: PLAN, sets: [set(), set()] });
    expect(out).toEqual({ ...draftFromSet(last, KG, "fresh"), rpe: "" });
  });
  it("logged without a plan is unchanged from 06.1", () => {
    const logged = set({ reps: 5, weight: 70, rpe: 7 });
    expect(reduceDraft(base({ attemptKey: "old", weightUnit: "lb" }), { type: "logged", set: logged })).toEqual({
      ...draftFromSet(logged, { weightUnit: "lb", distanceUnit: "km" }, "fresh"),
      rpe: "",
    });
  });
  it("seed: rebuilds the draft for the given list with a fresh key", () => {
    expect(reduceDraft(base({ reps: "typed", attemptKey: "old" }), { type: "seed", plannedSets: PLAN, sets: [set()], defaults: KG })).toEqual(
      base({ reps: "8", weight: "80", weightUnit: "kg", setType: "working", attemptKey: "fresh" }),
    );
  });
});
