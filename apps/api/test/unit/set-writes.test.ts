import { describe, expect, it } from "vitest";
import type { MeasureName, Modality } from "@sin/core";
import { ValidationError } from "../../src/errors/app-error.js";
import {
  assertSetMeasuresValid,
  fieldsToMeasures,
  isWorkingSetComplete,
  mergeSetPatch,
  type SetMeasures,
} from "../../src/repositories/set-writes.js";
import type { SetEntryRecord } from "../../src/repositories/workout.js";

const EMPTY: SetMeasures = {
  setType: "working",
  reps: null,
  weight: null,
  weightUnit: null,
  distance: null,
  distanceUnit: null,
  durationS: null,
  calories: null,
  isComplete: false,
};

/** A value for each measure, with its unit where one is needed. */
const FILL: Record<MeasureName, Partial<SetMeasures>> = {
  reps: { reps: 5 },
  weight: { weight: 100, weightUnit: "kg" },
  distance: { distance: 5, distanceUnit: "km" },
  durationS: { durationS: 60 },
  calories: { calories: 20 },
};
const REQUIRED: Record<Modality, MeasureName[]> = {
  weight_reps: ["weight", "reps"],
  bodyweight_reps: ["reps"],
  weighted_bodyweight: ["reps", "weight"],
  duration: ["durationS"],
  distance_duration: ["distance", "durationS"],
  calories: ["calories"],
  weight_distance: ["weight", "distance"],
  weight_duration: ["weight", "durationS"],
};
const FORBIDDEN: Record<Modality, MeasureName[]> = {
  weight_reps: ["durationS", "distance", "calories"],
  bodyweight_reps: ["weight", "durationS", "distance", "calories"],
  weighted_bodyweight: ["durationS", "distance", "calories"],
  duration: ["weight", "reps", "distance", "calories"],
  distance_duration: ["weight", "reps", "calories"],
  calories: ["weight", "reps", "distance", "durationS"],
  weight_distance: ["reps", "durationS", "calories"],
  weight_duration: ["reps", "distance", "calories"],
};
const complete = (modality: Modality): SetMeasures =>
  Object.assign({ ...EMPTY, isComplete: true }, ...REQUIRED[modality].map((n) => FILL[n]));

function fieldPaths(fn: () => void): string[] {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).fieldErrors!.map((f) => f.path).sort();
  }
  throw new Error("expected ValidationError");
}

describe("AC6 — required measures gate isComplete: true", () => {
  for (const modality of Object.keys(REQUIRED) as Modality[]) {
    it(`${modality}: a complete set passes`, () => {
      expect(() => assertSetMeasuresValid(modality, complete(modality))).not.toThrow();
    });
    for (const missing of REQUIRED[modality]) {
      it(`${modality}: missing ${missing} with isComplete: true is 422 naming it`, () => {
        const m = complete(modality);
        const cleared: SetMeasures = { ...m, ...Object.fromEntries(Object.keys(FILL[missing]).map((k) => [k, null])) };
        expect(fieldPaths(() => assertSetMeasuresValid(modality, cleared))).toEqual([missing]);
      });
    }
    it(`${modality}: every measure missing with isComplete false/omitted is legal`, () => {
      expect(() => assertSetMeasuresValid(modality, EMPTY)).not.toThrow();
    });
  }
  it("lists every missing field in one 422, not just the first (§6.1 point 4)", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, isComplete: true }))).toEqual([
      "reps",
      "weight",
    ]);
  });
});

describe("AC6 / D14 — the required gate applies to every set type", () => {
  for (const setType of ["warmup", "drop", "failure"] as const) {
    it(`${setType}: isComplete true with no measures is 422 naming every required measure`, () => {
      expect(
        fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, setType, isComplete: true })),
      ).toEqual(["reps", "weight"]);
    });
    it(`${setType}: isComplete true with every required measure passes`, () => {
      expect(() => assertSetMeasuresValid("weight_reps", { ...complete("weight_reps"), setType })).not.toThrow();
    });
    it(`${setType}: no measures with isComplete false is legal`, () => {
      expect(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, setType })).not.toThrow();
    });
    it(`${setType}: a forbidden measure is still 422; unit pairing still applies`, () => {
      expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, setType, durationS: 30 }))).toEqual([
        "durationS",
      ]);
      expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, setType, weight: 60 }))).toEqual([
        "weightUnit",
      ]);
    });
  }
  it("a failed attempt is a complete failure set with reps: 0 and the weight", () => {
    expect(() =>
      assertSetMeasuresValid("weight_reps", {
        ...EMPTY,
        setType: "failure",
        reps: 0,
        weight: 140,
        weightUnit: "kg",
        isComplete: true,
      }),
    ).not.toThrow();
  });
});

describe("AC7 — forbidden measures are rejected regardless of isComplete", () => {
  for (const modality of Object.keys(FORBIDDEN) as Modality[]) {
    for (const bad of FORBIDDEN[modality]) {
      for (const isComplete of [false, true]) {
        it(`${modality}: ${bad} present (isComplete ${isComplete}) is 422 naming it`, () => {
          const base = isComplete ? complete(modality) : EMPTY;
          expect(fieldPaths(() => assertSetMeasuresValid(modality, { ...base, ...FILL[bad] }))).toContain(bad);
        });
      }
    }
  }
});

describe("AC20 — unit accompanies value, checked first", () => {
  it("weight without weightUnit names weightUnit; weightUnit without weight names weight", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, weight: 50 }))).toEqual(["weightUnit"]);
    expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", { ...EMPTY, weightUnit: "kg" }))).toEqual(["weight"]);
  });
  it("same for distance / distanceUnit", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("distance_duration", { ...EMPTY, distance: 5 }))).toEqual([
      "distanceUnit",
    ]);
    expect(fieldPaths(() => assertSetMeasuresValid("distance_duration", { ...EMPTY, distanceUnit: "km" }))).toEqual([
      "distance",
    ]);
  });
  it("fires before the modality checks: a unitless weight on a duration set reports only the pairing error", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("duration", { ...EMPTY, weight: 50 }))).toEqual(["weightUnit"]);
  });
});

describe("Review Focus 1 / D11 — distance is bounded after conversion to meters", () => {
  it("deferred minor 87 — the message spells meters the American way", () => {
    try {
      assertSetMeasuresValid("distance_duration", { ...EMPTY, durationS: 60, distance: 1000, distanceUnit: "km" });
    } catch (e) {
      expect((e as ValidationError).fieldErrors).toEqual([{ path: "distance", message: "must not exceed 999999.999 meters" }]);
      return;
    }
    throw new Error("expected ValidationError");
  });

  it("999.999 km fits distance_m; 1000 km does not; 700 mi does not", () => {
    const base = { ...EMPTY, durationS: 60 };
    expect(() =>
      assertSetMeasuresValid("distance_duration", { ...base, distance: 999.999, distanceUnit: "km" }),
    ).not.toThrow();
    expect(
      fieldPaths(() => assertSetMeasuresValid("distance_duration", { ...base, distance: 1000, distanceUnit: "km" })),
    ).toEqual(["distance"]);
    expect(
      fieldPaths(() => assertSetMeasuresValid("distance_duration", { ...base, distance: 700, distanceUnit: "mi" })),
    ).toEqual(["distance"]);
  });
  it("checks the value Postgres will store: 999.9999 km rounds to 1000.000 km (numeric(9,3)), so it is rejected", () => {
    const base = { ...EMPTY, durationS: 60 };
    expect(
      fieldPaths(() =>
        assertSetMeasuresValid("distance_duration", { ...base, distance: 999.9999, distanceUnit: "km" }),
      ),
    ).toEqual(["distance"]);
  });
});

describe("§6.5 — isWorkingSetComplete", () => {
  it("true iff every required measure is non-null", () => {
    expect(isWorkingSetComplete("weight_reps", { reps: 5, weight: 100, distance: null, durationS: null, calories: null })).toBe(true);
    expect(isWorkingSetComplete("weight_reps", { reps: null, weight: 100, distance: null, durationS: null, calories: null })).toBe(false);
    expect(isWorkingSetComplete("duration", { reps: null, weight: null, distance: null, durationS: 0, calories: null })).toBe(true);
  });
});

const stored = (o: Partial<SetEntryRecord> = {}): SetEntryRecord => ({
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000010",
  workoutExerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000005",
  clientGeneratedId: null,
  setNumber: 1,
  setType: "working",
  reps: 5,
  weight: 100,
  weightUnit: "kg",
  weightKg: 100,
  distance: null,
  distanceUnit: null,
  distanceM: null,
  durationS: null,
  calories: null,
  rpe: 8,
  isComplete: false,
  completedAt: null,
  createdAt: new Date("2026-09-27T10:00:00Z"),
  updatedAt: new Date("2026-09-27T10:00:00Z"),
  ...o,
});

describe("AC8 / AC20 — mergeSetPatch: omitted keeps, null clears", () => {
  it("{} keeps every stored value", () => {
    expect(mergeSetPatch(stored(), {})).toEqual({
      setType: "working",
      reps: 5,
      weight: 100,
      weightUnit: "kg",
      distance: null,
      distanceUnit: null,
      durationS: null,
      calories: null,
      rpe: 8,
      isComplete: false,
    });
  });
  it("{ weight: 52.5 } keeps the stored weightUnit, so the merged row passes pairing", () => {
    const merged = mergeSetPatch(stored(), { weight: 52.5 });
    expect(merged).toMatchObject({ weight: 52.5, weightUnit: "kg" });
    expect(() => assertSetMeasuresValid("weight_reps", merged)).not.toThrow();
  });
  it("{ weight: 52.5 } against a set with no stored unit fails naming weightUnit", () => {
    const merged = mergeSetPatch(stored({ weight: null, weightUnit: null }), { weight: 52.5 });
    expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", merged))).toEqual(["weightUnit"]);
  });
  it("{ rpe: null } clears; setType keeps unless given", () => {
    expect(mergeSetPatch(stored(), { rpe: null }).rpe).toBeNull();
    expect(mergeSetPatch(stored(), { setType: "drop" }).setType).toBe("drop");
  });
  it("Review Focus 3 — clearing a required measure on a stored-complete set is 422", () => {
    const merged = mergeSetPatch(stored({ isComplete: true }), { reps: null });
    expect(merged.isComplete).toBe(true);
    expect(fieldPaths(() => assertSetMeasuresValid("weight_reps", merged))).toEqual(["reps"]);
  });
});

describe("fieldsToMeasures — create-side defaults", () => {
  it("absent measures are null, setType defaults to working, isComplete to false", () => {
    expect(fieldsToMeasures({})).toEqual({
      setType: "working",
      reps: null,
      weight: null,
      weightUnit: null,
      distance: null,
      distanceUnit: null,
      durationS: null,
      calories: null,
      rpe: null,
      isComplete: false,
    });
  });
});

describe("05.3 AC9 — forbidden and half-filled matrix", () => {
  const MODALITIES = Object.keys(REQUIRED) as Modality[];
  for (const modality of MODALITIES) {
    for (const name of FORBIDDEN[modality]) {
      it(`${modality}: ${name} is refused with path ${name}`, () => {
        expect(fieldPaths(() => assertSetMeasuresValid(modality, { ...EMPTY, ...FILL[name] }))).toEqual([name]);
      });
    }
    it(`${modality}: an empty isComplete: false set passes`, () => {
      expect(() => assertSetMeasuresValid(modality, EMPTY)).not.toThrow();
    });
    it(`${modality}: a complete set passes`, () => {
      expect(() => assertSetMeasuresValid(modality, complete(modality))).not.toThrow();
    });
  }
  it("calories is refused on each of the five legacy modalities", () => {
    for (const m of ["weight_reps", "bodyweight_reps", "weighted_bodyweight", "duration", "distance_duration"] as const) {
      expect(fieldPaths(() => assertSetMeasuresValid(m, { ...complete(m), calories: 20 }))).toEqual(["calories"]);
    }
  });
  it("weight_distance: weightUnit with no weight yields exactly the pairing error", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("weight_distance", { ...EMPTY, weightUnit: "kg", reps: 5 }))).toEqual(["weight"]);
  });
  it("weight_distance: distanceUnit with no distance yields exactly the pairing error", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("weight_distance", { ...EMPTY, distanceUnit: "ft", calories: 3 }))).toEqual(["distance"]);
  });
  it("weight_duration: a complete set missing durationS names it", () => {
    expect(fieldPaths(() => assertSetMeasuresValid("weight_duration", { ...complete("weight_duration"), durationS: null }))).toEqual(["durationS"]);
  });
});

describe("05.3 — mergeSetPatch keeps calories", () => {
  it("an omitted key keeps the stored 20, null clears it, 25 replaces it", () => {
    const s = stored({ calories: 20, reps: null, weight: null, weightUnit: null, weightKg: null });
    expect(mergeSetPatch(s, {}).calories).toBe(20);
    expect(mergeSetPatch(s, { calories: null }).calories).toBeNull();
    expect(mergeSetPatch(s, { calories: 25 }).calories).toBe(25);
  });
  it("Review Focus 1 — PATCH { isComplete: true } on a stored weight_reps set merges calories: null and passes", () => {
    const next = mergeSetPatch(stored(), { isComplete: true });
    expect(next.calories).toBeNull();
    expect(() => assertSetMeasuresValid("weight_reps", next)).not.toThrow();
  });
  it("fieldsToMeasures defaults an absent calories to null and keeps a sent one", () => {
    expect(fieldsToMeasures({}).calories).toBeNull();
    expect(fieldsToMeasures({ calories: 12 }).calories).toBe(12);
  });
});
