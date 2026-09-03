import { describe, expect, it } from "vitest";
import {
  KM_TO_M,
  LB_TO_KG,
  MI_TO_M,
  kgToLb,
  kmToM,
  lbToKg,
  mToKm,
  mToMi,
  miToM,
  toCanonicalKg,
  toCanonicalMeters,
} from "../src/units.js";

describe("AC6 — weight → canonical kg matches the DB generated-column formula", () => {
  it("kg is identity", () => {
    for (const v of [0, 1, 60, 142.5, 999.999]) {
      expect(toCanonicalKg(v, "kg")).toBe(v);
    }
  });

  it("lb uses the exact factor 0.45359237", () => {
    const cases: Array<[number, number]> = [
      [0, 0],
      [1, 0.45359237],
      [45, 20.41165665],
      [135, 61.23496995],
      [225, 102.05828325],
    ];
    for (const [lb, kg] of cases) {
      expect(toCanonicalKg(lb, "lb")).toBe(lb * 0.45359237);
      expect(toCanonicalKg(lb, "lb")).toBeCloseTo(kg, 8);
    }
  });

  it("LB_TO_KG is the international avoirdupois pound", () => {
    expect(LB_TO_KG).toBe(0.45359237);
  });

  it("kg ↔ lb round-trips within 1e-9", () => {
    for (const x of [1, 20, 60, 100, 315]) {
      expect(kgToLb(lbToKg(x))).toBeCloseTo(x, 9);
      expect(lbToKg(kgToLb(x))).toBeCloseTo(x, 9);
    }
  });
});

describe("AC7 — distance → canonical metres", () => {
  it("m is identity", () => {
    for (const v of [0, 1, 400, 1234.5]) expect(toCanonicalMeters(v, "m")).toBe(v);
  });

  it("km = value × 1000", () => {
    expect(toCanonicalMeters(5, "km")).toBe(5000);
    expect(toCanonicalMeters(1.5, "km")).toBe(1500);
  });

  it("mi = value × 1609.344 (exact)", () => {
    expect(toCanonicalMeters(1, "mi")).toBe(1609.344);
    expect(toCanonicalMeters(3, "mi")).toBe(3 * 1609.344);
  });

  it("exported constants are the values Spec 05's distance_m column must reuse", () => {
    expect(KM_TO_M).toBe(1000);
    expect(MI_TO_M).toBe(1609.344);
  });

  it("metre ↔ km / mi round-trip within 1e-9", () => {
    for (const x of [1, 5, 10, 42.195]) {
      expect(mToKm(kmToM(x))).toBeCloseTo(x, 9);
      expect(mToMi(miToM(x))).toBeCloseTo(x, 9);
    }
  });
});

describe("exhaustiveness guard — an unknown unit throws, never misconverts", () => {
  it("toCanonicalKg throws on a unit outside WeightUnit", () => {
    // A JS caller / deserialized payload could pass this despite the types.
    expect(() => toCanonicalKg(100, "st" as never)).toThrow(/unhandled unit: st/);
  });

  it("toCanonicalMeters throws on a unit outside DistanceUnit", () => {
    expect(() => toCanonicalMeters(5, "yd" as never)).toThrow(/unhandled unit: yd/);
  });
});

describe("AC8 — conversion never rounds", () => {
  it("returns the raw product, not a pre-rounded result", () => {
    expect(toCanonicalKg(1, "lb")).toBe(0.45359237);
    // 0.1 lb → a value that only survives if nothing rounds it.
    expect(toCanonicalKg(0.1, "lb")).toBe(0.1 * 0.45359237);
    expect(toCanonicalMeters(0.001, "mi")).toBe(0.001 * 1609.344);
  });
});
