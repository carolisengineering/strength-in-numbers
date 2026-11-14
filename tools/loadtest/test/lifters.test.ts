import { describe, expect, it } from "vitest";
import { lifterEnv, lifterSeeds, readLifters, runNonce, type LifterInput } from "../src/plan/lifters.ts";
import { startBody } from "../src/plan/payloads.ts";
import { createRng } from "../src/plan/rng.ts";
import { seededRoutineSets } from "../src/plan/routine.ts";
import { buildSession } from "../src/plan/session.ts";

const ROUTINE = "0190f6c2-2222-7000-8000-000000000001";
const lifters = (n: number, tokenLength = 20): LifterInput[] =>
  Array.from({ length: n }, (_, i) => ({ token: `${"t".repeat(tokenLength)}${i}`, routineId: ROUTINE }));

describe("minor 367 — one variable per lifter", () => {
  it("round-trips the lifters in order", () => {
    const xs = lifters(3);
    expect(readLifters(lifterEnv(xs))).toEqual(xs);
  });

  it("keeps every variable small at 150 Auth0-length tokens", () => {
    const env = lifterEnv(lifters(150, 1200));
    expect(Object.keys(env)).toHaveLength(151);
    for (const [key, value] of Object.entries(env)) expect(Buffer.byteLength(value), key).toBeLessThan(8192);
  });

  it("puts exactly one lifter's token in each variable", () => {
    const xs = lifters(150, 1200);
    const env = lifterEnv(xs);
    for (let i = 0; i < xs.length; i += 1) {
      const value = env[`LOADTEST_LIFTER_${i}`]!;
      expect(JSON.parse(value)).toEqual({ token: xs[i]!.token, routineId: ROUTINE });
      const others = xs.filter((x, j) => j !== i && value.includes(`"${x.token}"`));
      expect(others).toEqual([]);
    }
  });

  it("names the missing variable without printing any token", () => {
    const [first] = lifters(1);
    const env = { LOADTEST_LIFTER_COUNT: "2", LOADTEST_LIFTER_0: JSON.stringify(first) };
    let message = "";
    try {
      readLifters(env);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/missing LOADTEST_LIFTER_1 \(lifter 2 of 2\)/);
    expect(message).not.toContain(first!.token);
  });

  it("reads no lifters from an empty environment", () => {
    expect(readLifters({})).toEqual([]);
  });
});

describe("minor 365 — a run nonce in the payload seed", () => {
  const NOW = new Date("2026-11-14T12:00:00.000Z");
  const id = (nonce: number) =>
    (startBody(ROUTINE, createRng(lifterSeeds(0, 0, nonce).payload), NOW) as { clientGeneratedId: string }).clientGeneratedId;

  it("keeps the plan seed, and so the session plan, independent of the nonce (AC2)", () => {
    const a = lifterSeeds(4, 2, 111).plan;
    const b = lifterSeeds(4, 2, 999).plan;
    expect(a).toBe(5 * 100_003 + 2);
    expect(b).toBe(a);
    const plan = (seed: number) => buildSession({ seed, sets: seededRoutineSets(), pushFactor: 1 });
    expect(plan(a)).toEqual(plan(b));
  });

  it("gives a lifter different client ids in different runs", () => {
    expect(id(111)).not.toBe(id(222));
  });

  it("gives a lifter the same client ids for the same nonce", () => {
    expect(id(111)).toBe(id(111));
  });

  it("never gives two lifters in one run the same payload seed", () => {
    const nonce = runNonce(NOW);
    const seeds = new Set(Array.from({ length: 150 }, (_, i) => lifterSeeds(i, 0, nonce).payload));
    expect(seeds.size).toBe(150);
  });

  it("keeps the nonce and every payload seed an unsigned 32-bit integer", () => {
    expect(runNonce(new Date(2 ** 33 + 5))).toBe(5);
    for (const nonce of [0, 5, 2 ** 32 - 1, runNonce(NOW)]) {
      for (const i of [0, 1, 149]) {
        const { payload } = lifterSeeds(i, 3, nonce);
        expect(Number.isInteger(payload)).toBe(true);
        expect(payload).toBeGreaterThanOrEqual(0);
        expect(payload).toBeLessThan(2 ** 32);
      }
    }
  });
});
